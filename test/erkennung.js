// Testfälle für die Texterkennung (Datum, Belegnummer, Betrag, Währung, Geschäft) mit typischen Kassenzettel-Texten.
// Neue echte Beispiele (nur den erkannten Text, siehe Admin → Protokoll → "Foto nicht erkannt") hier ergänzen.
const { extractDatum, extractBelegnummer, extractBetrag, extractGeschaeft } = require('../scan');
const heute = new Date("2026-10-01");
let fehler = 0;

const faelle = [
  { name: 'Coop (Bon-Nr., Total CHF)',
    text: 'Coop Supermarkt Frutigen\nBahnhofstrasse 12\n3714 Frutigen\nTel. 058 123 45 67\nKasse 3  Bon 20482173\n14.09.2026 10:17\nBrot 4.20\nKäse 12.80\nTOTAL CHF 52.05\nBar CHF 60.00\nRückgeld CHF 7.95\nMWST-Nr. CHE-105.920.456',
    erwartet: { datum: '2026-09-14', nr: '173', betrag: 52.05, waehrung: 'CHF', geschaeft: 'Coop Supermarkt Frutigen' } },
  { name: 'Migros (Beleg-Nr., Summe)',
    text: 'MIGROS ADELBODEN\nDorfstrasse 3\nBeleg-Nr: 004512\nDatum: 03.09.26 17:42\nMilch 1.75\nSumme CHF 23.40\nCumulus-Nr 2000 1234 5678',
    erwartet: { datum: '2026-09-03', nr: '512', betrag: 23.4, waehrung: 'CHF', geschaeft: 'Migros Adelboden' } },
  { name: 'Landi (Total, Trans.)',
    text: 'LANDI FRUTIGEN\nIndustriestrasse 4\nUID CHE-105.920.456 MWST\nTrans. 77 12 94\n2026-09-14 10:17:42\nKatzenfutter 3x 11.70\nTotal 52.05\nCHF',
    erwartet: { datum: '2026-09-14', nr: '294', betrag: 52.05, waehrung: 'CHF', geschaeft: 'Landi Frutigen' } },
  { name: 'Deutscher Markt (EUR, Komma, Bon-Nr)',
    text: 'REWE Markt GmbH\nHauptstr. 5\n79098 Freiburg\nBon-Nr. 5521\n12.09.2026   14:32\nBananen 1,99\nGESAMTBETRAG 48,50 EUR\nGegeben 50,00\nRückgeld 1,50',
    erwartet: { datum: '2026-09-12', nr: '521', betrag: 48.5, waehrung: 'EUR', geschaeft: 'REWE Markt GmbH' } },
  { name: 'Restaurant (Rechnung Nr., Total mit Tausenderpunkt)',
    text: 'Restaurant Sonne\nRechnung Nr 2026/00123\n05.09.2026\n2x Rösti 38.00\nTotal CHF 1\'052.05',
    erwartet: { datum: '2026-09-05', nr: '123', betrag: 1052.05, waehrung: 'CHF', geschaeft: 'Restaurant Sonne' } },
  { name: 'OCR-Fehler (O statt 0, l statt 1)',
    text: 'Denner AG\nBeleg 4l2O\n1O.O9.2O26\nTOTAL CHF 9.8O',
    erwartet: { datum: '2026-09-10', nr: '120', geschaeft: 'Denner AG' } },
  { name: 'Betrag in der nächsten Zeile',
    text: 'Volg Achseten\nBon 8812\n21.09.2026\nTotal\n34.60 CHF',
    erwartet: { datum: '2026-09-21', nr: '812', betrag: 34.6, waehrung: 'CHF', geschaeft: 'Volg Achseten' } },
  { name: 'Tankstelle (Bon in Tabellenzeile unten, Steuernummer ist keine Belegnummer)',
    text: 'ANKSTELLE\nuornummer: 040/8093/808\nSumme EUR 36,09\nMasterCard EUR 36,09\nTA-Nr_ 406080 BNr 8758\nDatum 17.03.26 22:27 Uhr\nTränsaktionsnummer: 1822124\nDatum Zeit_ Bon_ POS _KNo Schicht\n17.093,26 22:27 63774 01 0005 254\nAut Wiedersehen',
    erwartet: { datum: '2026-03-17', nr: '774', betrag: 36.09, waehrung: 'EUR' } },
  { name: 'Tankstelle, schlechter Durchgang (Summe mehrfach, einmal falsch gelesen)',
    text: 'x EUR\nSumme EUR 3,07\nMasterCard EUR 36,0 K\nEUR 36,09\nSumme EUR 36,09\nDatum 19.03.26 22:27 Uhr\nAnmeldezeit (Start): 17.03.2026 22:27:55\nAnmeldezeit (Ende): 17.03.2026 22:27:55',
    erwartet: { datum: '2026-03-17', betrag: 36.09, waehrung: 'EUR', geschaeft: null } },
  { name: 'Tankstelle: 3 als 9 gelesen, MwSt-Gegenprobe wählt den richtigen Betrag',
    text: 'Summe EUR 96,09\n19,00 % MWST. A EUR 5,76\nMasterCard EUR 96,09\nSumme Netto EUR 30,33\nEUR 36,09\nSumme EUR 36,09',
    erwartet: { betrag: 36.09 } },
  { name: 'Zukünftiges / unmögliches Datum wird ignoriert',
    text: 'Laden\nGültig bis 31.12.2030\n31.02.2026',
    erwartet: { datum: null } },
  { name: 'Nur Telefon/UID: keine Belegnummer',
    text: 'Tel. 033 673 12 34\nMwSt-Nr CHE-123.456.789',
    erwartet: { nr: null } },
  { name: 'Rückgeld/Bar sind nicht der Betrag',
    text: 'Rückgeld CHF 7.95\nBar 60.00',
    erwartet: { betrag: null } },
];

for (const f of faelle) {
  const e = f.erwartet, ist = {};
  if ('datum' in e) ist.datum = extractDatum(f.text, heute);
  if ('nr' in e) ist.nr = extractBelegnummer(f.text);
  if ('betrag' in e) { const b = extractBetrag(f.text); ist.betrag = b ? b.betrag : null; if ('waehrung' in e) ist.waehrung = b ? b.waehrung : null; }
  if ('geschaeft' in e) ist.geschaeft = extractGeschaeft(f.text);
  const ok = Object.keys(e).every(k => ist[k] === e[k]);
  console.log((ok ? '  ✓ ' : '  ✗ ') + f.name + (ok ? '' : '\n      erwartet ' + JSON.stringify(e) + '\n      erhalten ' + JSON.stringify(ist)));
  if (!ok) fehler++;
}
console.log(fehler ? `\nFEHLGESCHLAGEN: ${fehler}` : '\nALLE ERKENNUNGSTESTS BESTANDEN');
process.exit(fehler ? 1 : 0);
