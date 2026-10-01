// Test der Belegungs-Auswertung (Zimmer-Raster) mit erfundenen Namen – gleicher Aufbau wie die echte Excel-Belegung:
// links Datum, rechts Zimmer, darüber die Kapazität, darunter die Gäste ("Name 4" = 4 Personen, "A & B" = 2, Wechsel mit "X Ab / Y An").
const vm = require('vm'), fs = require('fs'), path = require('path');
const ctx = {}; ctx.self = ctx; ctx.window = ctx; vm.createContext(ctx);
const pub = path.join(__dirname, '..', 'public');
vm.runInContext(fs.readFileSync(path.join(pub, 'vendor', 'xlsx.full.min.js'), 'utf8'), ctx);
vm.runInContext(fs.readFileSync(path.join(pub, 'belegung-liste.js'), 'utf8'), ctx);
const X = ctx.XLSX, B = ctx.BelegungListe;
let fehler = 0;
const ok = (b, t) => { console.log((b ? '  ✓ ' : '  ✗ ') + t); if (!b) fehler++; };

const serial = (m, d) => Math.round((Date.UTC(2026, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
const tage = []; for (let d = 1; d <= 12; d++) tage.push(serial(4, d));
const kopf = ['', '', 'Datum', 'Zimmer 1\r\n(Küche)', 'Zimmer 2 (Doppelbett)', 'Bärengraben', 'Mass 8', 'Mass 8', 'Mass 8'];
const zeilen = [
  ['', '', 'Titel Belegung 2026'],
  ['', '', '', '4 Personen', '2 Personen', '2 Personen'],
  kopf,
];
// Tage 1..12 (April): Zimmer 1: Anna 4 (1.-6.), Tom (6.-9.); Zimmer 2: Lara (1.-12.); Bärengraben: "Dirk & Mia" (1.-4.), Wechsel am 5. "D+M Ab / J+A An", "Jan & Ada" (6.-9.)
const z1 = ['Anna 4', 'Anna 4', 'Anna 4', 'Anna 4', 'Anna 4', 'Anna 4/ Tom', 'Tom', 'Tom', 'Tom', '', '', ''];
const bg = ['Dirk& Mia', 'Dirk& Mia', 'Dirk& Mia', 'Dirk& Mia', 'D+M Ab / J+A An', 'Jan& Ada', 'Jan& Ada', 'Jan& Ada', 'Jan& Ada', '', '', ''];
tage.forEach((t, i) => zeilen.push(['', '', t, z1[i], 'Lara', bg[i], i >= 2 && i <= 6 ? 'Max' : '', i >= 2 && i <= 6 ? 'Gruppe Z 3' : '', i >= 2 && i <= 6 ? 'Gruppe Z 3' : '']));
// zweiter Block ohne Kopfzeile, nur mit Titel "Massenlager groß 12"
zeilen.push(['', '', '', 'Massenlager groß 12']);
for (let d = 1; d <= 4; d++) zeilen.push(['', '', serial(5, d), 'Kai', d >= 2 ? 'Eli' : '']);

const ws = X.utils.aoa_to_sheet(zeilen);
// Datumszellen als Datum formatieren (wie in einer echten Excel-Datei)
Object.keys(ws).forEach(k => { if (k[0] !== '!' && ws[k].t === 'n') ws[k].z = 'dd.mm.yyyy'; });
const wb = { SheetNames: ['Belegung'], Sheets: { Belegung: ws } };
const r = B.arbeitsmappeAuswerten(wb);
const f = (n) => r.eintraege.find(e => e.name === n);
ok(r.art === 'raster', 'Zimmer-Raster wird erkannt');
ok(f('Anna') && f('Anna').personen === 4 && f('Anna').von === '2026-04-01' && f('Anna').bis === '2026-04-06' && /Zimmer 1 \(Küche\)/.test(f('Anna').zimmer), 'Name + Zahl = Personen; Zimmername ohne Zeilenumbruch');
ok(f('Tom') && f('Tom').von === '2026-04-06' && f('Tom').bis === '2026-04-09' && f('Tom').personen === 1, 'Wechsel „Anna 4/ Tom“: Anna bis zum Wechseltag, Tom ab dem Wechseltag; ein Name = 1 Person');
ok(f('Lara') && f('Lara').von === '2026-04-01' && f('Lara').bis === '2026-04-12', 'Langer Aufenthalt über alle Tage');
ok(f('Dirk & Mia') && f('Dirk & Mia').personen === 2 && f('Dirk & Mia').bis === '2026-04-05' && f('Dirk & Mia').von === '2026-04-01', 'Zwei Namen = 2 Personen; „D+M Ab“ verlängert bis zum Wechseltag (Kürzel erkannt)');
ok(f('Jan & Ada') && f('Jan & Ada').von === '2026-04-05' && f('Jan & Ada').bis === '2026-04-09', '„J+A An“ beginnt am Wechseltag (Kürzel dem vollen Namen zugeordnet)');
ok(f('Gruppe Z') && f('Gruppe Z').personen === 3 && f('Gruppe Z').zimmer === 'Massenlager', '„Gruppe Z 3“ in 2 Spalten = EIN Aufenthalt mit 3 Personen (nicht doppelt gezählt)');
ok(f('Max') && f('Max').personen === 1 && f('Max').zimmer === 'Massenlager', '„Mass 8“ wird zu „Massenlager“');
ok(f('Kai') && f('Kai').zimmer === 'Massenlager groß' && f('Kai').von === '2026-05-01' && f('Kai').bis === '2026-05-04', 'Block ohne Kopfzeile bekommt den Titel als Zimmer („Massenlager groß“)');
ok(f('Eli') && f('Eli').von === '2026-05-02', 'Späterer Einzug im zweiten Block');
const t = B.proTag(r.eintraege);
const am = t.find(x => x.tag === '2026-04-03');
ok(am && am.personen === 4 + 1 + 2 + 1 + 3, 'Pro Tag: Personen am 03.04. = 11 (' + (am && am.personen) + ')');
const u = B.uebersicht(r.eintraege, '2026-04-05');
ok(u.personen === 4 + 1 + 2 + 2 + 1 + 3, 'Übersicht am Wechseltag (05.04.): 13 Personen – beide Paare zählen, weil sie an diesem Tag da sind (' + u.personen + ')');
ok(u.naechsteAbreise.length > 0 && u.naechsteAnreise.length > 0, 'Übersicht: nächste Abreise und Anreise vorhanden');

// Einfache Liste (Anreise/Abreise)
const wsl = X.utils.aoa_to_sheet([['Gruppe', 'Anreise', 'Abreise', 'Personen'], ['Verein A', serial(6, 1), serial(6, 3), 12]]);
['B2', 'C2'].forEach(a => { wsl[a].z = 'dd.mm.yyyy'; });
const rl = B.arbeitsmappeAuswerten({ SheetNames: ['L'], Sheets: { L: wsl } });
ok(rl.art === 'liste' && rl.eintraege.length === 1 && rl.eintraege[0].personen === 12 && rl.eintraege[0].von === '2026-06-01', 'Einfache Liste mit Anreise/Abreise wird ebenfalls erkannt');
const leer = B.arbeitsmappeAuswerten({ SheetNames: ['X'], Sheets: { X: X.utils.aoa_to_sheet([['nur', 'Text'], ['kein', 'Datum']]) } });
ok(leer.eintraege.length === 0 && leer.art === null, 'Tabelle ohne Belegung: nichts gefunden (keine falschen Einträge)');
console.log(fehler ? `\nFEHLGESCHLAGEN: ${fehler}` : '\nALLE PARSER-TESTS BESTANDEN');
process.exit(fehler ? 1 : 0);
