// Datensicherheit: automatische Sicherungen, Integritätsprüfung, Warnung bei fehlendem Volume, ZIP-Export.
// Grundsatz: Beim Start und danach täglich wird eine konsistente Kopie der Datenbank angelegt
// (SQLite "VACUUM INTO"), bevor irgendetwas migriert oder geändert wird.
const fs = require('fs');
const path = require('path');

const BEHALTE_START = 10;   // letzte Sicherungen von Serverstarts (= vor jeder Änderung/Migration)
const BEHALTE_TAG = 14;     // letzte tägliche Sicherungen

function erstelle({ db, dataDir, uploadsDir }) {
  const ordner = path.join(dataDir, 'backups');
  fs.mkdirSync(ordner, { recursive: true });

  const stempel = () => new Date().toISOString().replace(/[:.]/g, '-');

  function snapshot(art) {
    const ziel = path.join(ordner, `belege-${stempel()}-${art}.db`);
    db.prepare('VACUUM INTO ?').run(ziel);
    rotiere();
    return ziel;
  }

  function liste() {
    return fs.readdirSync(ordner)
      .filter(f => /^belege-.*\.db$/.test(f))
      .map(f => { const st = fs.statSync(path.join(ordner, f)); return { datei: f, bytes: st.size, zeit: st.mtime.toISOString() }; })
      .sort((a, b) => b.zeit.localeCompare(a.zeit));
  }

  function rotiere() {
    for (const [art, behalte] of [['start', BEHALTE_START], ['tag', BEHALTE_TAG], ['manuell', 20]]) {
      liste().filter(b => b.datei.endsWith(`-${art}.db`)).slice(behalte)
        .forEach(b => { try { fs.unlinkSync(path.join(ordner, b.datei)); } catch (e) {} });
    }
  }

  // Täglich eine Sicherung (prüft alle 3 Stunden, ob heute schon eine existiert)
  function taeglich() {
    const heute = new Date().toISOString().slice(0, 10);
    if (!liste().some(b => b.datei.startsWith(`belege-${heute}`) && b.datei.endsWith('-tag.db'))) {
      try { snapshot('tag'); } catch (e) { console.error('Tägliche Sicherung fehlgeschlagen:', e.message); }
    }
  }

  // Auf Railway sind Dateien im Container nach jedem Deploy weg – ausser sie liegen auf einem Volume.
  function volumeStatus() {
    const aufRailway = !!(process.env.RAILWAY_ENVIRONMENT || process.env.RAILWAY_PROJECT_ID || process.env.RAILWAY_SERVICE_ID);
    const mount = process.env.RAILWAY_VOLUME_MOUNT_PATH ? path.resolve(process.env.RAILWAY_VOLUME_MOUNT_PATH) : null;
    const liegtIn = p => !!mount && (path.resolve(p) === mount || path.resolve(p).startsWith(mount + path.sep));
    const sicher = !aufRailway || (liegtIn(dataDir) && liegtIn(uploadsDir));
    return { aufRailway, volume: mount, datenbankAufVolume: liegtIn(dataDir), uploadsAufVolume: liegtIn(uploadsDir), sicher };
  }

  function pruefe() {
    let integritaet = 'unbekannt';
    try { integritaet = db.prepare('PRAGMA integrity_check').get().integrity_check; } catch (e) { integritaet = 'Fehler: ' + e.message; }
    const belege = db.prepare('SELECT id, dateipfad FROM belege WHERE geloescht_am IS NULL').all();
    const alleDateien = db.prepare('SELECT id, dateipfad FROM belege UNION ALL SELECT beleg_id, dateipfad FROM beleg_fotos').all();
    const fehlend = [...new Set(alleDateien.filter(b => b.dateipfad && !fs.existsSync(path.join(uploadsDir, b.dateipfad))).map(b => b.id))];
    const sicherungen = liste();
    return {
      datenbankOk: integritaet === 'ok',
      integritaet,
      anzahlBelege: belege.length,
      anzahlMitDatei: belege.filter(b => b.dateipfad).length,
      fehlendeDateien: fehlend,
      sicherungen: sicherungen.slice(0, 5),
      anzahlSicherungen: sicherungen.length,
      letzteSicherung: sicherungen[0] ? sicherungen[0].zeit : null,
      volume: volumeStatus()
    };
  }

  // ZIP mit konsistenter DB-Kopie + allen Belegfotos + Belegung/Gerichte-Dateien
  function zipFuellen(zip, tmpDb) {
    zip.file(tmpDb, { name: 'belege.db' });
    if (fs.existsSync(uploadsDir)) zip.glob('**/*', { cwd: uploadsDir, ignore: ['.scan-tmp/**'], dot: false }, { prefix: 'uploads' });
    for (const sub of ['belegung', 'gerichte']) {
      const d = path.join(dataDir, sub);
      if (fs.existsSync(d)) zip.directory(d, sub);
    }
  }

  function zipSchreiben(res) {
    const archiver = require('archiver');
    const tmp = path.join(ordner, `export-${stempel()}.tmp.db`);
    db.prepare('VACUUM INTO ?').run(tmp);
    const zip = archiver('zip', { zlib: { level: 6 } });
    const aufraeumen = () => { try { fs.unlinkSync(tmp); } catch (e) {} };
    res.on('close', aufraeumen);
    zip.on('error', err => { aufraeumen(); res.destroy(err); });
    zip.pipe(res);
    zipFuellen(zip, tmp);
    zip.finalize();
  }

  // Dasselbe als Datei (für E-Mail-Backup). Liefert { pfad, bytes }
  function zipDatei() {
    const archiver = require('archiver');
    const tmp = path.join(ordner, `export-${stempel()}.tmp.db`);
    const ziel = path.join(ordner, `export-${stempel()}.tmp.zip`);
    db.prepare('VACUUM INTO ?').run(tmp);
    return new Promise((resolve, reject) => {
      const out = fs.createWriteStream(ziel);
      const zip = archiver('zip', { zlib: { level: 6 } });
      out.on('close', () => { try { fs.unlinkSync(tmp); } catch (e) {} resolve({ pfad: ziel, bytes: fs.statSync(ziel).size }); });
      zip.on('error', err => { try { fs.unlinkSync(tmp); } catch (e) {} reject(err); });
      zip.pipe(out);
      zipFuellen(zip, tmp);
      zip.finalize();
    });
  }

  // Nur die Datenbank (gzip) – klein genug für eine E-Mail
  function dbGzDatei() {
    const zlib = require('zlib');
    const tmp = path.join(ordner, `export-${stempel()}.tmp.db`);
    const ziel = tmp.replace('.tmp.db', '.tmp.db.gz');
    db.prepare('VACUUM INTO ?').run(tmp);
    fs.writeFileSync(ziel, zlib.gzipSync(fs.readFileSync(tmp)));
    try { fs.unlinkSync(tmp); } catch (e) {}
    return { pfad: ziel, bytes: fs.statSync(ziel).size };
  }

  // Aufräumen übrig gebliebener Export-Dateien (z.B. nach Absturz)
  try { fs.readdirSync(ordner).filter(f => /\.tmp\.(db|zip|db\.gz)$/.test(f)).forEach(f => fs.unlinkSync(path.join(ordner, f))); } catch (e) {}

  return { ordner, snapshot, liste, taeglich, pruefe, volumeStatus, zipSchreiben, zipDatei, dbGzDatei };
}

module.exports = { erstelle };
