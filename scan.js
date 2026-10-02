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

function datumDetails(text, heute = new Date()) {
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
  const zaehler = {};
  kandidaten.forEach(k => { zaehler[k.iso] = (zaehler[k.iso] || 0) + 2 + k.bonus; });
  // Meiste Treffer gewinnt (ein einzelner Lesefehler soll nicht entscheiden); bei Gleichstand das erste Datum im Text
  const iso = kandidaten.map(k => k.iso).sort((a, b) => zaehler[b] - zaehler[a])[0];
  const treffer = kandidaten.filter(k => k.iso === iso).length;
  // sicher = mindestens zweimal gelesen und kein abweichendes Datum auf dem Beleg
  return { iso, sicher: treffer >= 2 && treffer === kandidaten.length };
}
function extractDatum(text, heute) { const d = datumDetails(text, heute); return d ? d.iso : null; }

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

function belegnummerDetails(text) {
  text = normalisiereZiffern(text);
  const zeilen = text.split(/\r?\n/);
  const tabelle = belegnummerAusTabelle(zeilen);
  if (tabelle) return { nr: tabelle, sicher: true };
  let schwach = null;
  for (const zeile of zeilen) {
    if (AUSSCHLUSS.test(zeile) || /\d+\/\d+\/\d+/.test(zeile)) continue;
    const s = zeile.match(STARK);
    if (s) {
      const rest = zeile.slice(s.index + s[0].length);
      const ziffern = ziffernDerZeile(rest.replace(/^[^\d]{0,25}/, m => (/\d/.test(m) ? '' : m)));
      if (ziffern.length >= 3) return { nr: ziffern.slice(-3), sicher: true };
    }
    if (!schwach) {
      const w = zeile.match(SCHWACH);
      if (w) {
        const ziffern = ziffernDerZeile(zeile.slice(w.index + w[0].length));
        if (ziffern.length >= 3) schwach = ziffern.slice(-3);
      }
    }
  }
  return schwach ? { nr: schwach, sicher: false } : null; // nur über "Nr." gefunden: unsicher
}
function extractBelegnummer(text) { const d = belegnummerDetails(text); return d ? d.nr : null; }

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

function betragDetails(text) {
  const zeilen = text.split(/\r?\n/);
  const stimmen = new Map(); // Betrag -> Anzahl Zeilen, in denen er als Summe steht (Belege nennen die Summe mehrfach)
  let erster = null;
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
      stimmen.set(werte[0], (stimmen.get(werte[0]) || 0) + 1.5); // Stichwort-Zeile zählt etwas mehr
      if (!erster) erster = { betrag: werte[0], quelle: z + ' ' + quelle };
    }
  }
  // Zusätzliche Stimmen: Zeilen, die mit "EUR 36,09" bzw. "CHF 52.05" enden (Kartenzahlung, Zahlbetrag)
  zeilen.forEach(z => {
    if (SUMME_AUS.test(z.replace(/mastercard|visa|maestro/ig, '')) && !/mastercard|visa|maestro|karte/i.test(z)) return;
    if (/mwst|ust|steuer|netto/i.test(z)) return;
    const m = z.match(/(?:EUR|CHF|€)\s?(\d+[.,]\d{2})\s*$/i);
    if (m) { const w = parseFloat(m[1].replace(',', '.')); stimmen.set(w, (stimmen.get(w) || 0) + 1); }
  });
  if (!erster) return null;
  // Gegenprobe über die Mehrwertsteuer: Zeile wie "19,00 % MWST. A EUR 5,76" – Brutto * Satz / (100 + Satz) muss den MwSt-Betrag ergeben (verhindert z.B. 96,09 statt 36,09)
  const steuerZeilen = [];
  zeilen.forEach(z => {
    if (!/mwst|mw-st|ust|tax/i.test(z)) return;
    const p = z.match(/(\d{1,2}(?:[.,]\d{1,3})?)\s?%/);
    if (!p) return;
    const satz = parseFloat(p[1].replace(',', '.'));
    const rest = z.slice(p.index + p[0].length);
    const werte = betraegeInZeile(rest);
    if (satz > 0 && satz < 30 && werte.length) steuerZeilen.push({ satz, mwst: werte[werte.length - 1] });
  });
  const passtZurSteuer = b => steuerZeilen.some(t => Math.abs(t.mwst - b * t.satz / (100 + t.satz)) < 0.0115);
  for (const [b] of stimmen) if (passtZurSteuer(b)) stimmen.set(b, stimmen.get(b) + 3);
  let korrigiert = false;
  if (steuerZeilen.length && ![...stimmen.keys()].some(passtZurSteuer)) {
    // Kein gelesener Betrag passt zur MwSt: häufige Ziffernverwechslungen (3/9, 0/8, 1/7, 5/6) durchprobieren
    // und Netto + MwSt als weiteren Kandidaten nehmen. Übernommen wird nur ein eindeutiger Treffer.
    const VERW = { 3: '9', 9: '3', 0: '8', 8: '0', 1: '7', 7: '1', 5: '6', 6: '5' };
    const treffer = new Set(), ausNetto = new Set();
    for (const [b] of stimmen) {
      const ziffern = b.toFixed(2).replace('.', '').split('');
      const pos = ziffern.map((c, i) => (VERW[c] ? i : -1)).filter(i => i >= 0);
      const probiere = v => { const w = parseInt(v.join(''), 10) / 100; if (passtZurSteuer(w)) treffer.add(w); };
      pos.forEach((i, x) => {
        const v = ziffern.slice(); v[i] = VERW[v[i]]; probiere(v);
        pos.slice(x + 1).forEach(j => { const v2 = v.slice(); v2[j] = VERW[v2[j]]; probiere(v2); });
      });
    }
    const netto = [];
    zeilen.filter(z => /netto/i.test(z)).forEach(z => netto.push(...betraegeInZeile(z)));
    netto.forEach(n => steuerZeilen.forEach(t => { const w = Math.round((n + t.mwst) * 100) / 100; if (passtZurSteuer(w)) { treffer.add(w); ausNetto.add(w); } }));
    // Eindeutig? Sonst: Netto + MwSt entscheidet, danach die kleinste Abweichung zur gelesenen MwSt
    const abw = w => Math.min(...steuerZeilen.map(t => Math.abs(t.mwst - w * t.satz / (100 + t.satz))));
    let kand = [...treffer];
    if (kand.length > 1 && [...ausNetto].some(w => treffer.has(w))) kand = [...ausNetto];
    if (kand.length > 1) { kand.sort((x, y) => abw(x) - abw(y)); if (abw(kand[1]) - abw(kand[0]) < 0.002) kand = []; else kand = [kand[0]]; }
    if (kand.length === 1) { stimmen.set(kand[0], 100); korrigiert = true; }
  }
  const beste = [...stimmen.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const mwstOk = passtZurSteuer(beste);
  // sicher = MwSt-Gegenprobe stimmt, oder (wenn der Beleg keine prüfbare MwSt-Zeile hat) der Betrag wurde dreimal gleich gelesen.
  // Gibt es eine MwSt-Zeile, die NICHT passt, ist der Betrag unsicher – auch wenn er mehrfach gleich gelesen wurde (Ziffernverwechslung).
  const sicher = steuerZeilen.length ? mwstOk : stimmen.get(beste) >= 3;
  return { betrag: beste, waehrung: waehrungIn(erster.quelle) || waehrungIn(text), sicher, korrigiert };
}
function extractBetrag(text) { const d = betragDetails(text); return d ? { betrag: d.betrag, waehrung: d.waehrung } : null; }

// Geschäftsname: meist die erste Textzeile (Logo/Name) ohne Ziffern
const GESCHAEFT_AUS = /^(kassenbon|kassenzettel|rechnung|quittung|beleg|bon\b|datum|total|summe|tel|fax|www|uid|mwst|danke|vielen|willkommen|herzlich|kasse|filiale|ihr einkauf|customer|receipt|invoice)/i;
const ZAHLUNG = /(\beur\b|\bchf\b|€|mastercard|master card|visa|maestro|karte|twint|summe|total)/i;
const ADRESSE = /(strasse|str\.|weg\b|platz|gasse|allee|postfach|bahnhof)/i;

function extractGeschaeft(text) {
  const zeilen = text.split(/\r?\n/).map(z => z.replace(/[|_~=*#]+/g, ' ').replace(/\s+/g, ' ').trim()).filter(Boolean).slice(0, 7);
  for (const roh of zeilen) {
    // Lesemüll-Wörter ("Sg", "x", "(") entfernen, nur echte Wörter behalten
    const z = roh.split(' ').filter(w => /^[\p{L}][\p{L}\-.]{2,}$/u.test(w) || /^\p{Lu}{2}$/u.test(w) || /\d/.test(w)).join(' ');
    if (z.length < 3 || z.length > 40 || /\d/.test(z) || GESCHAEFT_AUS.test(z) || ADRESSE.test(z) || ZAHLUNG.test(z)) continue;
    const buchstaben = (z.match(/\p{L}/gu) || []).length;
    if (buchstaben < 3 || buchstaben / z.length < 0.75) continue;
    if (!/\p{L}{4,}/u.test(z)) continue; // Lesemüll wie "Mc An" nicht als Name übernehmen
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
  // Messung mit verkleinerten Handyfotos: der Textblock-Modus (6) liest Beträge deutlich zuverlässiger als die automatische Seitenanalyse (3).
  // Deshalb zuerst Modus 6; Modus 3 nur als Ergänzung für fehlende Felder.
  let text = await lies(dateipfad, 6);
  let datum = extractDatum(text), belegnummer = extractBelegnummer(text), summe = extractBetrag(text), geschaeft = extractGeschaeft(text);
  if (!datum || !belegnummer || !summe) {
    const text2 = await lies(dateipfad, 3);
    datum = datum || extractDatum(text2);
    belegnummer = belegnummer || extractBelegnummer(text2);
    summe = summe || extractBetrag(text2);
    geschaeft = geschaeft || extractGeschaeft(text2);
    text = text + '\n--- 2. Durchgang ---\n' + text2;
  }
  const dd = datumDetails(text), nd = belegnummerDetails(text), bd = betragDetails(text);
  // "sicher": mehrfach bzw. durch Gegenprobe bestätigt. Nur dann kann der Beleg als verifiziert gelten.
  const sicher = { datum: !!(dd && dd.iso === datum && dd.sicher), belegnummer: !!(nd && nd.nr === belegnummer && nd.sicher), betrag: !!(bd && summe && bd.betrag === summe.betrag && bd.sicher) };
  return { datum, belegnummer, betrag: summe ? summe.betrag : null, waehrung: summe ? summe.waehrung : null, geschaeft, sicher, text };
}

const ERKENNUNG_VERSION = 7; // hochzählen, wenn die Auswertung geändert wird (wird in der App angezeigt)
module.exports = { ERKENNUNG_VERSION, datumDetails, belegnummerDetails, betragDetails, scanneBeleg, extractDatum, extractBelegnummer, extractBetrag, extractGeschaeft };
