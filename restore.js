// Stellt die Datenbank aus einer Sicherung wieder her.
//   node restore.js <Sicherungsdatei.db>        (Server vorher stoppen!)
// Die aktuelle Datenbank wird vorher als belege.db.vor-restore-<Zeit> gesichert – nichts geht verloren.
const fs = require('fs');
const path = require('path');
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const quelle = process.argv[2];
if (!quelle) {
  const ordner = path.join(dataDir, 'backups');
  console.log('Verwendung: node restore.js <Sicherungsdatei.db>\nVorhandene Sicherungen in ' + ordner + ':');
  if (fs.existsSync(ordner)) fs.readdirSync(ordner).filter(f => f.endsWith('.db')).sort().reverse().forEach(f => console.log('  ' + path.join(ordner, f)));
  process.exit(1);
}
if (!fs.existsSync(quelle)) { console.error('Datei nicht gefunden: ' + quelle); process.exit(1); }
const ziel = path.join(dataDir, 'belege.db');
if (fs.existsSync(ziel)) {
  const sicher = `${ziel}.vor-restore-${new Date().toISOString().replace(/[:.]/g, '-')}`;
  fs.copyFileSync(ziel, sicher);
  console.log('Aktuelle Datenbank gesichert nach: ' + sicher);
}
for (const ext of ['-wal', '-shm']) { try { fs.unlinkSync(ziel + ext); } catch (e) {} }
fs.copyFileSync(quelle, ziel);
console.log('Wiederhergestellt aus: ' + quelle + '\nServer jetzt neu starten.');
