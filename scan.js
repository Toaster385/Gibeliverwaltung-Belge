// Belegerkennung: OCR (tesseract.js, läuft komplett auf dem Server, keine externen Dienste)
// und Auswertung von Datum + Belegnummer aus dem erkannten Text.
const path = require('path');

// ---------- Textauswertung (rein, ohne OCR – gut testbar) ----------
const pad = n => String(n).padStart(2, '0');

// OCR verwechselt in Zahlen oft O/o mit 0 und l/I/| mit 1
function normalisiereZiffern(text) {
  return text
    .replace(/(?<=\d)[Oo](?=[\d.,\/-])|(?<=[\d.,\/-])[Oo](?=\d)|(?<=\d)[Oo](?![\p{L}])/gu, '0')
    .replace(/(?<=\d)[lI|](?=[\d.,\/-])|(?<=[\d.,\/-])[lI|](?=\d)/g, '1');
}

function extractDatum(text, heute = new Date()) {
  text = normalisiereZiffern(text);
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

// Tabellen-Fuss vieler Kassen: Kopfzeile "Datum Zeit Bon POS KNo Schicht", darunter die Werte "17.03.26 22:27 63774 01 0005 254"
function belegnummerAusTabelle(zeilen) {
  for (let i = 0; i < zeilen.length - 1; i++) {
    const kopf = zeilen[i].split(/[\s_]+/).filter(Boolean);
    const idx = kopf.findIndex(t => /^(bon|beleg|belegnr|bonnr)$/i.test(t));
    if (idx < 0 || kopf.length < 3) continue;
    const naechste = zeilen.slice(i + 1).find(x => x.trim());
    if (!naechste) continue;
    const werte = naechste.split(/[\s_]+/).filter(Boolean);
    let wert = werte.length === kopf.length ? werte[idx] : null;
    if (!wert || !/^\d{3,}$/.test(wert)) wert = werte.find(t => /^\d{3,}$/.test(t) && !/^\d{1,2}[.,]\d/.test(t));
    if (wert && /^\d{3,}$/.test(wert)) return wert.slice(-3);
  }
  return null;
}

function extractBelegnummer(text) {
  text = normalisiereZiffern(text);
  const zeilen = text.split(/\r?\n/);
  const tabelle = belegnummerAusTabelle(zeilen);
  if (tabelle) return tabelle;
  let schwach = null;
  for (const zeile of zeilen) {
    if (AUSSCHLUSS.test(zeile) || /\d+\/\d+\/\d+/.test(zeile)) continue;
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

// Betrag + Währung: Zeile mit Stichwort wie TOTAL / Summe / Gesamt / zu zahlen
const SUMME_STARK = /(total|summe|gesamt|zu zahlen|zahlbetrag|endbetrag|amount due|à payer|betrag)/i;
const SUMME_AUS = /(zwischen|sub\s?total|mwst|mw-st|ust|steuer|tax|rück|rueck|change|gegeben|bezahlt|paid|rabatt|bar\b|cumulus|punkte|artikel|anzahl)/i;
const BETRAG_RE = /(?<![\d.,'’])(\d{1,3}(?:['’ ]\d{3})+|\d+)\s?[.,]\s?(\d{2})(?![\d])/g;

function betraegeInZeile(zeile) {
  const out = [];
  let m;
  BETRAG_RE.lastIndex = 0;
  while ((m = BETRAG_RE.exec(zeile))) out.push(parseFloat(m[1].replace(/\D/g, '') + '.' + m[2]));
  return out;
}

function waehrungIn(text) {
  const chf = (text.match(/\bCHF\b|\bSFr\.?|\bFr\.(?=\s?\d)/gi) || []).length;
  const eur = (text.match(/\bEUR\b|€/gi) || []).length;
  if (!chf && !eur) return null;
  return chf >= eur ? 'CHF' : 'EUR';
}

function extractBetrag(text) {
  const zeilen = text.split(/\r?\n/);
  for (let i = 0; i < zeilen.length; i++) {
    const z = zeilen[i];
    const k = z.match(SUMME_STARK);
    if (!k || SUMME_AUS.test(z)) continue;
    let werte = betraegeInZeile(z.slice(k.index + k[0].length));
    let quelle = z;
    if (!werte.length) { // Betrag steht manchmal in der nächsten Zeile
      const naechste = zeilen.slice(i + 1).find(x => x.trim());
      if (naechste && !SUMME_AUS.test(naechste)) { werte = betraegeInZeile(naechste); quelle = naechste; }
    }
    if (werte.length && werte[0] > 0) {
      return { betrag: werte[0], waehrung: waehrungIn(z) || waehrungIn(quelle) || waehrungIn(text) };
    }
  }
  return null;
}

// Geschäftsname: meist die erste Textzeile (Logo/Name) ohne Ziffern
const GESCHAEFT_AUS = /^(kassenbon|kassenzettel|rechnung|quittung|beleg|bon\b|datum|total|summe|tel|fax|www|uid|mwst|danke|vielen|willkommen|herzlich|kasse|filiale|ihr einkauf|customer|receipt|invoice)/i;
const ADRESSE = /(strasse|str\.|weg\b|platz|gasse|allee|postfach|bahnhof)/i;

function extractGeschaeft(text) {
  const zeilen = text.split(/\r?\n/).map(z => z.replace(/[|_~=*#]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 7);
  for (const z of zeilen) {
    if (z.length < 3 || z.length > 40 || /\d/.test(z) || GESCHAEFT_AUS.test(z) || ADRESSE.test(z)) continue;
    const buchstaben = (z.match(/\p{L}/gu) || []).length;
    if (buchstaben < 3 || buchstaben / z.length < 0.75) continue;
    // GROSSBUCHSTABEN -> Normale Schreibweise ("LANDI FRUTIGEN" -> "Landi Frutigen")
    if (z === z.toUpperCase()) return z.toLowerCase().replace(/(^|[\s\-])(\p{L})/gu, (m, a, b) => a + b.toUpperCase());
    return z;
  }
  return null;
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

function lies(dateipfad, psm) {
  if (wartende >= MAX_WARTENDE) return Promise.reject(new Error('ausgelastet'));
  wartende++;
  const job = warteschlange.then(async () => {
    const worker = await getWorker();
    let timer;
    const timeout = new Promise((_, rej) => { timer = setTimeout(() => rej(new Error('timeout')), TIMEOUT_MS); });
    try {
      await worker.setParameters({ tessedit_pageseg_mode: String(psm || 3) });
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
  let text = await lies(dateipfad, 3); // automatische Seitenanalyse
  let datum = extractDatum(text), belegnummer = extractBelegnummer(text), summe = extractBetrag(text), geschaeft = extractGeschaeft(text);
  if (!datum || !belegnummer || !summe) {
    // Zweiter Versuch: Beleg als einheitlicher Textblock lesen (hilft bei schmalen Kassenzetteln)
    const text2 = await lies(dateipfad, 6);
    datum = datum || extractDatum(text2);
    belegnummer = belegnummer || extractBelegnummer(text2);
    summe = summe || extractBetrag(text2);
    geschaeft = geschaeft || extractGeschaeft(text2);
    text = text + '\n--- 2. Durchgang ---\n' + text2;
  }
  return { datum, belegnummer, betrag: summe ? summe.betrag : null, waehrung: summe ? summe.waehrung : null, geschaeft, text };
}

module.exports = { scanneBeleg, extractDatum, extractBelegnummer, extractBetrag, extractGeschaeft };
