// Excel-Bereiche: "Aktuelle Belegung" und "Gerichte"
// Beide funktionieren identisch: alle Angemeldeten sehen die Tabelle, hochladen/ersetzen/löschen darf nur, wer das Schreibrecht hat.
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db } = require('../lib/db');
const { dirs } = require('../lib/config');
const { requireLogin, requireVerwaltung, requireGerichte } = require('../lib/auth');
const { protokolliere } = require('../lib/protokoll');

function registriere(app, { url, dir, praefix, standardName, titel, schreibRecht }) {
  const setting = key => db.prepare(`SELECT wert FROM einstellungen WHERE schluessel = ?`).get(`${praefix}_${key}`);
  const speichere = (key, wert) => db.prepare(`INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES (?, ?)`).run(`${praefix}_${key}`, wert);

  const upload = multer({
    storage: multer.diskStorage({
      destination: (req, file, cb) => cb(null, dir),
      filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname)}`)
    }),
    limits: { fileSize: 20 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      if (['.xlsx', '.xls', '.ods'].includes(ext)) return cb(null, true);
      cb(new Error('Nur Excel-Dateien (.xlsx, .xls, .ods) erlaubt'));
    }
  });

  for (const k of ['dateiname', 'dateipfad', 'hochgeladen_am']) {
    db.prepare(`INSERT OR IGNORE INTO einstellungen (schluessel, wert) VALUES (?, '')`).run(`${praefix}_${k}`);
  }

  app.get(`${url}/datei`, requireLogin, (req, res) => {
    const dateipfad = setting('dateipfad');
    if (!dateipfad?.wert) return res.status(404).json({ error: 'Keine Datei vorhanden' });
    const filePath = path.join(dir, path.basename(dateipfad.wert));
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });
    res.sendFile(filePath);
  });

  app.get(url, requireLogin, (req, res) => {
    const dateiname = setting('dateiname'), dateipfad = setting('dateipfad'), hochgeladen = setting('hochgeladen_am');
    if (!dateipfad?.wert) return res.json({ vorhanden: false });
    if (!fs.existsSync(path.join(dir, path.basename(dateipfad.wert)))) return res.json({ vorhanden: false });
    res.json({ vorhanden: true, dateiname: dateiname?.wert || standardName, hochgeladen_am: hochgeladen?.wert || '' });
  });

  app.post(url, schreibRecht, (req, res, next) => upload.single('datei')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Fehler beim Hochladen' }); // immer JSON, nie eine HTML-Fehlerseite
    next();
  }), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    const alt = setting('dateipfad');
    if (alt?.wert) { try { fs.unlinkSync(path.join(dir, path.basename(alt.wert))); } catch (e) {} }
    speichere('dateiname', req.file.originalname);
    speichere('dateipfad', req.file.filename);
    speichere('hochgeladen_am', new Date().toISOString());
    protokolliere(req.session.benutzer, 'excel_hochgeladen', 'excel', null, `${titel}: ${req.file.originalname}`);
    res.json({ success: true, dateiname: req.file.originalname });
  });

  app.delete(url, schreibRecht, (req, res) => {
    const dateipfad = setting('dateipfad');
    if (dateipfad?.wert) { try { fs.unlinkSync(path.join(dir, path.basename(dateipfad.wert))); } catch (e) {} }
    speichere('dateiname', ''); speichere('dateipfad', ''); speichere('hochgeladen_am', '');
    protokolliere(req.session.benutzer, 'excel_geloescht', 'excel', null, titel);
    res.json({ success: true });
  });
}

module.exports = function (app) {
  registriere(app, { url: '/api/belegung', dir: dirs.belegungDir, praefix: 'belegung', standardName: 'belegung.xlsx', titel: 'Aktuelle Belegung', schreibRecht: requireVerwaltung });
  registriere(app, { url: '/api/gerichte', dir: dirs.gerichteDir, praefix: 'gerichte', standardName: 'gerichte.xlsx', titel: 'Gerichte', schreibRecht: requireGerichte });
};
