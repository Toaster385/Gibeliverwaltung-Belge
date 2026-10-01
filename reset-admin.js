// Setzt das Passwort eines Admins zurück (z.B. bei vergessenem Passwort). Server vorher stoppen.
//   node reset-admin.js <Benutzername> <NeuesPasswort>
const path = require('path');
const Database = require('better-sqlite3');
const bcrypt = require('bcryptjs');
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const [name, pw] = process.argv.slice(2);
if (!name || !pw || pw.length < 8) { console.error('Verwendung: node reset-admin.js <Benutzername> <NeuesPasswort (mind. 8 Zeichen)>'); process.exit(1); }
const db = new Database(path.join(dataDir, 'belege.db'));
const u = db.prepare('SELECT id, rolle FROM benutzer WHERE benutzername = ?').get(name);
if (!u) { console.error('Benutzer nicht gefunden'); process.exit(1); }
db.prepare(`UPDATE benutzer SET passwort = ?, muss_passwort_aendern = 0, rolle = CASE WHEN ',' || rolle || ',' LIKE '%,admin,%' THEN rolle ELSE rolle || ',admin' END WHERE id = ?`).run(bcrypt.hashSync(pw, 10), u.id);
console.log(`Passwort für "${name}" gesetzt (Admin-Rolle sichergestellt).`);
