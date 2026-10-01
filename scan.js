// Belegerkennung: OCR (tesseract.js, läuft komplett auf dem Server, keine externen Dienste)
// und Auswertung von Datum + Belegnummer aus dem erkannten Text.
const path = require('path');

// ---------- Textauswertung (rein, ohne OCR – gut testbar) ----------
const pad = n => String(n).padStart(2, '0');

function extractDatum(text, heute = new Date()) {
  const kandidaten = [];
  const re = /(?<!\d)(\d{1,2})\s?[.,\/-]\s?(\d{1,2})\s?[.,\/-]\s?(\d{4}|\d{2})(?!\d)|(?<!\d)(20\d{2})-(\d{2})-(\d{2})(?!\d)/g;
  let m;
  while ((m = re.exec(text))) {
    let y, mo, d;
    if (m[4]) { y = +m[4]; mo = +m[5]; d = +m[6]; }
    else { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    const dt = new Date(Date.UTC(y, mo - 1, d));
    if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo - 1 || dt.getUTCDate() !== d) continue;
    const diffTage = (Date.UTC(heute.getFullYear(), heute.getMonth(), heute.getDate()) - dt.getTime()) / 86400000;
    if (diffTage < -1 || diffTage > 800) continue; // nicht in der Zukunft, nicht älter als ~2 Jahre
    const vorher = text.slice(Math.max(0, m.index - 14), m.index);
    kandidaten.push({ iso: `${y}-${pad(mo)}-${pad(d)}`, bonus: /dat(um)?|date/i.test(vorher) ? 1 : 0 });
  }
  if (!kandidaten.length) return null;
  kandidaten.sort((a, b) => b.bonus - a.bonus); // stabil: sonst erstes Datum im Text
  return kandidaten[0].iso;
}

const STARK = /(beleg|bon\b|kassenbon|kassenzettel|rechnung|rechn\.?|quittung|transaktion|trans\b|ticket|receipt|invoice|facture|ref(erenz)?)/i;
const SCHWACH = /(?:^|[^a-z])(nr|no|nummer|n°|#)\.?/i;
const AUSSCHLUSS = /(tel|fax|uid|mwst|mw-st|ust|steuer|iban|bic|plz|www\.|@|konto|kunden|karte|card|terminal|trace)/i;

function ziffernDerZeile(teil) {
  const m = teil.match(/(\d[\d\s.\-\/]{1,24}\d|\d)/);
  if (!m) return '';
  return m[1].replace(/\D/g, '');
}

function extractBelegnummer(text) {
  const zeilen = text.split(/\r?\n/);
  let schwach = null;
  for (const zeile of zeilen) {
    if (AUSSCHLUSS.test(zeile)) continue;
    const s = zeile.match(STARK);
    if (s) {
      const rest = zeile.slice(s.index + s[0].length);
      const ziffern = ziffernDerZeile(rest.replace(/^[^\d]{0,25}/, m => (/\d/.test(m) ? '' : m)));
      if (ziffern.length >= 3) return ziffern.slice(-3);
    }
    if (!schwach) {
      const w = zeile.match(SCHWACH);
      if (w) {
        const ziffern = ziffernDerZeile(zeile.slice(w.index + w[0].length));
        if (ziffern.length >= 3) schwach = ziffern.slice(-3);
      }
    }
  }
  return schwach;
}

// ---------- OCR ----------
let workerPromise = null;
let warteschlange = Promise.resolve();
let wartende = 0;
const MAX_WARTENDE = 4;
const TIMEOUT_MS = 60000;

function getWorker() {
  if (!workerPromise) {
    const { createWorker } = require('tesseract.js');
    const deu = require('@tesseract.js-data/deu');
    workerPromise = createWorker('deu', 1, { langPath: deu.langPath, gzip: deu.gzip, cachePath: require('os').tmpdir(),
      // Ohne errorHandler wirft tesseract.js bei unlesbaren Bildern eine unbehandelte Exception und beendet den ganzen Server.
      // Der Fehler erreicht den Aufrufer bereits über das abgelehnte recognize()-Promise.
      errorHandler: () => {} })
      .catch(e => { workerPromise = null; throw e; });
  }
  return workerPromise;
}

function lies(dateipfad) {
  if (wartende >= MAX_WARTENDE) return Promise.reject(new Error('ausgelastet'));
  wartende++;
  const job = warteschlange.then(async () => {
    const worker = await getWorker();
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS); });
    try {
      const res = await Promise.race([worker.recognize(dateipfad), timeout]);
      return res.data.text || '';
    } catch (e) {
      // Worker nach Timeout/Fehler verwerfen, nächster Auftrag startet frisch
      const alt = workerPromise; workerPromise = null;
      if (alt) alt.then(w => w.terminate()).catch(() => {});
      throw e;
    } finally { clearTimeout(timer); }
  });
  warteschlange = job.catch(() => {}).then(() => { wartende--; });
  return job;
}

async function scanneBeleg(dateipfad) {
  const text = await lies(dateipfad);
  return { datum: extractDatum(text), belegnummer: extractBelegnummer(text), textLaenge: text.length };
}

module.exports = { scanneBeleg, extractDatum, extractBelegnummer };
