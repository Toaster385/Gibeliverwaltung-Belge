// Zentrale Konfiguration (Pfade, Port, Geheimnisse)
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const root = path.join(__dirname, '..');
const dataDir = process.env.DATA_DIR || path.join(root, 'data');
const uploadsDir = process.env.UPLOADS_DIR || path.join(root, 'uploads');
const dirs = {
  root,
  publicDir: path.join(root, 'public'),
  dataDir,
  uploadsDir,
  belegungDir: path.join(dataDir, 'belegung'),
  gerichteDir: path.join(dataDir, 'gerichte'),
  scanTmpDir: path.join(uploadsDir, '.scan-tmp') // Punkt-Ordner: wird nie ausgeliefert
};
for (const d of [dataDir, uploadsDir, dirs.belegungDir, dirs.gerichteDir, dirs.scanTmpDir]) fs.mkdirSync(d, { recursive: true });

// Sitzungs-Geheimnis: aus der Umgebung, sonst einmalig zufällig erzeugt und im Datenordner gespeichert
// (kein im Code sichtbarer Standardwert mehr).
function sessionSecret() {
  if (process.env.SESSION_SECRET) return process.env.SESSION_SECRET;
  const datei = path.join(dataDir, '.session-secret');
  try {
    const s = fs.readFileSync(datei, 'utf8').trim();
    if (s.length >= 32) return s;
  } catch (e) {}
  const s = crypto.randomBytes(48).toString('hex');
  fs.writeFileSync(datei, s, { mode: 0o600 });
  console.log('Hinweis: SESSION_SECRET nicht gesetzt – es wurde ein zufälliges Geheimnis in ' + datei + ' gespeichert.');
  return s;
}

module.exports = {
  PORT: process.env.PORT || 3000,
  dirs,
  secret: sessionSecret(),
  ALLE_ROLLEN: ['admin', 'gibeli-gast', 'verwaltung', 'gerichte']
};
