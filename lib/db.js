// Datenbank öffnen, VOR jeder Änderung sichern, Migrationen (nur hinzufügend), Grunddaten.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const datensicherheit = require('../datensicherheit');
const { dirs, ALLE_ROLLEN } = require('./config');

const dbPfad = path.join(dirs.dataDir, 'belege.db');
const dbExistierte = fs.existsSync(dbPfad) && fs.statSync(dbPfad).size > 0;
const db = new Database(dbPfad);
// Belege im Papierkorb dürfen auf bereits gelöschte Benutzer verweisen (siehe Papierkorb-Anzeige)
db.pragma('foreign_keys = OFF');

const sicherung = datensicherheit.erstelle({ db, dataDir: dirs.dataDir, uploadsDir: dirs.uploadsDir });
function zaehle() {
  try {
    return {
      belege: db.prepare('SELECT COUNT(*) AS n FROM belege').get().n,
      benutzer: db.prepare('SELECT COUNT(*) AS n FROM benutzer').get().n
    };
  } catch (e) { return { belege: 0, benutzer: 0 }; } // Tabellen existieren noch nicht (Erststart)
}
const vorStart = zaehle();
if (dbExistierte) {
  try {
    const f = sicherung.snapshot('start');
    console.log(`Sicherung vor dem Start: ${f} (${vorStart.belege} Belege, ${vorStart.benutzer} Benutzer)`);
  } catch (e) {
    console.error('FEHLER: Sicherung vor dem Start nicht möglich – Start abgebrochen, Daten bleiben unverändert:', e.message);
    process.exit(1);
  }
}
const volume = sicherung.volumeStatus();
if (!volume.sicher) {
  console.error('\n!!! WARNUNG !!! Die Daten liegen NICHT auf einem Railway-Volume und gehen beim nächsten Deploy verloren.\n' +
    '    Volume anlegen (Mount z.B. /data) und DATA_DIR=/data, UPLOADS_DIR=/data/uploads setzen. Siehe README.\n');
}

db.exec(`
  CREATE TABLE IF NOT EXISTS benutzer (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benutzername TEXT UNIQUE NOT NULL,
    passwort TEXT NOT NULL DEFAULT '',
    rolle TEXT NOT NULL DEFAULT 'gibeli-gast',
    geburtsdatum TEXT,
    erstellt_am TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS belege (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benutzer_id INTEGER NOT NULL DEFAULT 1,
    datum TEXT NOT NULL,
    geschaeft TEXT NOT NULL DEFAULT '',
    betrag REAL NOT NULL,
    kategorie TEXT NOT NULL DEFAULT 'Sonstiges',
    notiz TEXT,
    dateiname TEXT,
    dateipfad TEXT,
    status TEXT NOT NULL DEFAULT 'ausstehend',
    waehrung TEXT NOT NULL DEFAULT 'EUR',
    erstellt_am TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (benutzer_id) REFERENCES benutzer(id)
  );
  CREATE TABLE IF NOT EXISTS einstellungen (
    schluessel TEXT PRIMARY KEY,
    wert TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS perioden (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    von TEXT NOT NULL,
    bis TEXT NOT NULL,
    erstellt_am TEXT NOT NULL DEFAULT (datetime('now'))
  );
`);

// Migrationen: ausschliesslich hinzufügend (neue Spalten/Tabellen) – nie löschend
const migrations = [
  `ALTER TABLE belege ADD COLUMN benutzer_id INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE benutzer ADD COLUMN geburtsdatum TEXT`,
  `ALTER TABLE belege ADD COLUMN status TEXT NOT NULL DEFAULT 'ausstehend'`,
  `ALTER TABLE belege ADD COLUMN waehrung TEXT NOT NULL DEFAULT 'EUR'`,
  `ALTER TABLE belege ADD COLUMN geschaeft TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE belege ADD COLUMN kategorie TEXT NOT NULL DEFAULT 'Sonstiges'`,
  `ALTER TABLE belege ADD COLUMN belegnummer TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE benutzer ADD COLUMN pin TEXT`,
  `ALTER TABLE belege ADD COLUMN verifiziert INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE belege ADD COLUMN auto_datum INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE belege ADD COLUMN auto_belegnummer INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE belege ADD COLUMN auto_betrag INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE belege ADD COLUMN auto_waehrung INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE belege ADD COLUMN auto_geschaeft INTEGER NOT NULL DEFAULT 0`,
  `ALTER TABLE belege ADD COLUMN geloescht_am TEXT`,
  `ALTER TABLE belege ADD COLUMN geloescht_von TEXT`,
  `ALTER TABLE belege ADD COLUMN client_id TEXT`,
  `ALTER TABLE benutzer ADD COLUMN muss_passwort_aendern INTEGER NOT NULL DEFAULT 0`,
];
for (const m of migrations) { try { db.exec(m); } catch (e) {} }

db.exec(`
  CREATE TABLE IF NOT EXISTS beleg_fotos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    beleg_id INTEGER NOT NULL,
    dateiname TEXT,
    dateipfad TEXT NOT NULL,
    erstellt_am TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX IF NOT EXISTS idx_beleg_fotos_beleg ON beleg_fotos(beleg_id);
  CREATE TABLE IF NOT EXISTS protokoll (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    zeit TEXT NOT NULL DEFAULT (datetime('now')),
    benutzer_id INTEGER,
    benutzername TEXT,
    aktion TEXT NOT NULL,
    ziel_typ TEXT,
    ziel_id INTEGER,
    details TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_protokoll_zeit ON protokoll(id DESC);
  CREATE UNIQUE INDEX IF NOT EXISTS idx_belege_client ON belege(benutzer_id, client_id) WHERE client_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_belege_geloescht ON belege(geloescht_am);
  CREATE TABLE IF NOT EXISTS excel_versionen (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    bereich TEXT NOT NULL,
    dateiname TEXT,
    dateipfad TEXT NOT NULL,
    hochgeladen_am TEXT NOT NULL,
    hochgeladen_von TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_excel_versionen ON excel_versionen(bereich, id DESC);
  CREATE TABLE IF NOT EXISTS sessions (
    sid TEXT PRIMARY KEY,
    sess TEXT NOT NULL,
    expired_at INTEGER NOT NULL
  );
`);

// Notbremse: Migrationen dürfen nie Belege oder Benutzer entfernen
{
  const nachher = zaehle();
  if (nachher.belege < vorStart.belege || nachher.benutzer < vorStart.benutzer) {
    console.error(`FEHLER: Nach der Migration fehlen Daten (Belege ${vorStart.belege}→${nachher.belege}, Benutzer ${vorStart.benutzer}→${nachher.benutzer}). Start abgebrochen. Sicherung liegt in ${sicherung.ordner}`);
    process.exit(1);
  }
}

const defaultSettings = { kasse_geschlossen: '0', aktive_periode: '0' };
for (const [k, v] of Object.entries(defaultSettings)) {
  db.prepare(`INSERT OR IGNORE INTO einstellungen (schluessel, wert) VALUES (?, ?)`).run(k, v);
}

// Alte Rollennamen vereinheitlichen
db.prepare(`UPDATE benutzer SET rolle = 'gibeli-gast' WHERE rolle NOT IN (${ALLE_ROLLEN.map(() => '?').join(',')}) AND instr(rolle, ',') = 0`).run(...ALLE_ROLLEN);

// ----- Admin-Konten -----
// Früher wurden Lio/Admin2/Admin3 mit festen Passwörtern bei JEDEM Start neu angelegt. Jetzt:
//  * nur wenn es überhaupt keinen Admin gibt (Erststart), mit Zufallspasswort bzw. INITIAL_ADMIN_PASSWORD
//  * Admins, die noch ein früheres Standardpasswort haben, müssen es beim nächsten Login ändern
const hatAdmin = db.prepare(`SELECT 1 FROM benutzer WHERE ',' || rolle || ',' LIKE '%,admin,%' LIMIT 1`).get();
if (!hatAdmin) {
  const pw = process.env.INITIAL_ADMIN_PASSWORD || crypto.randomBytes(9).toString('base64url');
  const name = process.env.INITIAL_ADMIN_NAME || 'Lio';
  db.prepare(`INSERT OR REPLACE INTO benutzer (benutzername, passwort, rolle, muss_passwort_aendern) VALUES (?, ?, 'admin', 1)`).run(name, bcrypt.hashSync(pw, 10));
  console.log('\n========================================================\n' +
    ` ERSTER START – Admin angelegt:  Benutzer: ${name}   Passwort: ${pw}\n` +
    ' Dieses Passwort wird nur jetzt angezeigt und muss beim ersten Login geändert werden.\n' +
    ' (Vergessen? -> node reset-admin.js <Name> <NeuesPasswort>)\n' +
    '========================================================\n');
}
const STANDARD_PASSWOERTER = ['2202', '1111', '1234', 'admin', 'passwort', 'password'];
for (const a of db.prepare(`SELECT id, benutzername, passwort FROM benutzer WHERE ',' || rolle || ',' LIKE '%,admin,%' AND muss_passwort_aendern = 0`).all()) {
  if (a.passwort && STANDARD_PASSWOERTER.some(p => bcrypt.compareSync(p, a.passwort))) {
    db.prepare('UPDATE benutzer SET muss_passwort_aendern = 1 WHERE id = ?').run(a.id);
    console.log(`Hinweis: Admin "${a.benutzername}" hat noch ein Standardpasswort und muss es beim nächsten Login ändern.`);
  }
}

module.exports = { db, sicherung };
