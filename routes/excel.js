// Excel-Bereiche: "Aktuelle Belegung" und "Gerichte"
// Alle Angemeldeten sehen die Tabelle. Hochladen/Löschen/Wiederherstellen darf nur, wer das Schreibrecht hat.
// Beim Ersetzen bleiben die letzten 5 Versionen erhalten und lassen sich wiederherstellen.
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { db } = require('../lib/db');
const { dirs } = require('../lib/config');
const { requireLogin, requireVerwaltung, requireGerichte, hatRolle } = require('../lib/auth');
const { protokolliere } = require('../lib/protokoll');

const BEHALTE_VERSIONEN = 5;

function registriere(app, { url, dir, praefix, standardName, titel, schreibRecht, schreibRollen, mitSpalten }) {
  const setting = key => db.prepare(`SELECT wert FROM einstellungen WHERE schluessel = ?`).get(`${praefix}_${key}`);
  const speichere = (key, wert) => db.prepare(`INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES (?, ?)`).run(`${praefix}_${key}`, wert);
  const darfSchreiben = req => hatRolle(req.session.benutzer, ...schreibRollen);
  const dateiPfad = name => path.join(dir, path.basename(name));

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

  for (const k of ['dateiname', 'dateipfad', 'hochgeladen_am', 'hochgeladen_von', 'spalten']) {
    db.prepare(`INSERT OR IGNORE INTO einstellungen (schluessel, wert) VALUES (?, '')`).run(`${praefix}_${k}`);
  }
  // Dateien, die vor Einführung der Versionen hochgeladen wurden, als erste Version aufnehmen
  const aktiv0 = setting('dateipfad')?.wert;
  if (aktiv0 && !db.prepare('SELECT 1 FROM excel_versionen WHERE bereich = ? AND dateipfad = ?').get(praefix, aktiv0)) {
    db.prepare('INSERT INTO excel_versionen (bereich, dateiname, dateipfad, hochgeladen_am, hochgeladen_von) VALUES (?, ?, ?, ?, ?)')
      .run(praefix, setting('dateiname')?.wert || standardName, aktiv0, setting('hochgeladen_am')?.wert || new Date().toISOString(), null);
  }

  function aufraeumen() {
    const aktiv = setting('dateipfad')?.wert;
    const alle = db.prepare('SELECT * FROM excel_versionen WHERE bereich = ? ORDER BY id DESC').all(praefix);
    let behalten = 0;
    for (const v of alle) {
      if (v.dateipfad === aktiv) continue;            // die angezeigte Version wird nie entfernt
      if (++behalten > BEHALTE_VERSIONEN - 1) {
        try { fs.unlinkSync(dateiPfad(v.dateipfad)); } catch (e) {}
        db.prepare('DELETE FROM excel_versionen WHERE id = ?').run(v.id);
      }
    }
  }
  const aktivSetzen = v => {
    speichere('dateiname', v ? v.dateiname : ''); speichere('dateipfad', v ? v.dateipfad : '');
    speichere('hochgeladen_am', v ? v.hochgeladen_am : ''); speichere('hochgeladen_von', v ? (v.hochgeladen_von || '') : '');
  };

  // Datei ausliefern: aktive Version für alle; frühere Versionen nur für Berechtigte
  app.get(`${url}/datei`, requireLogin, (req, res) => {
    let name = setting('dateipfad')?.wert, anzeigename = setting('dateiname')?.wert || standardName;
    if (req.query.version) {
      if (!darfSchreiben(req)) return res.status(403).json({ error: 'Kein Zugriff' });
      const v = db.prepare('SELECT * FROM excel_versionen WHERE id = ? AND bereich = ?').get(req.query.version, praefix);
      if (!v) return res.status(404).json({ error: 'Version nicht gefunden' });
      name = v.dateipfad; anzeigename = v.dateiname;
    }
    if (!name) return res.status(404).json({ error: 'Keine Datei vorhanden' });
    const filePath = dateiPfad(name);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });
    if (req.query.download) return res.download(filePath, anzeigename);
    res.sendFile(filePath);
  });

  app.get(url, requireLogin, (req, res) => {
    const kannSchreiben = darfSchreiben(req);
    const dateipfad = setting('dateipfad')?.wert;
    const vorhanden = !!dateipfad && fs.existsSync(dateiPfad(dateipfad));
    const antwort = { vorhanden, kannSchreiben };
    if (mitSpalten) { try { antwort.spalten = JSON.parse(setting('spalten')?.wert || 'null'); } catch (e) { antwort.spalten = null; } }
    if (vorhanden) Object.assign(antwort, {
      dateiname: setting('dateiname')?.wert || standardName,
      hochgeladen_am: setting('hochgeladen_am')?.wert || '',
      hochgeladen_von: setting('hochgeladen_von')?.wert || ''
    });
    if (kannSchreiben) {
      antwort.versionen = db.prepare('SELECT id, dateiname, hochgeladen_am, hochgeladen_von, dateipfad FROM excel_versionen WHERE bereich = ? ORDER BY id DESC').all(praefix)
        .filter(v => fs.existsSync(dateiPfad(v.dateipfad)))
        .map(v => ({ id: v.id, dateiname: v.dateiname, hochgeladen_am: v.hochgeladen_am, hochgeladen_von: v.hochgeladen_von, aktiv: v.dateipfad === dateipfad }));
    }
    res.json(antwort);
  });

  app.post(url, schreibRecht, (req, res, next) => upload.single('datei')(req, res, err => {
    if (err) return res.status(400).json({ error: err.message || 'Fehler beim Hochladen' });
    next();
  }), (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
    const jetzt = new Date().toISOString();
    const r = db.prepare('INSERT INTO excel_versionen (bereich, dateiname, dateipfad, hochgeladen_am, hochgeladen_von) VALUES (?, ?, ?, ?, ?)')
      .run(praefix, req.file.originalname, req.file.filename, jetzt, req.session.benutzer.benutzername);
    aktivSetzen({ dateiname: req.file.originalname, dateipfad: req.file.filename, hochgeladen_am: jetzt, hochgeladen_von: req.session.benutzer.benutzername });
    aufraeumen();
    protokolliere(req.session.benutzer, 'excel_hochgeladen', 'excel', r.lastInsertRowid, `${titel}: ${req.file.originalname}`);
    res.json({ success: true, dateiname: req.file.originalname });
  });

  // "Löschen" nimmt die Datei aus der Anzeige; die Version bleibt wiederherstellbar
  app.delete(url, schreibRecht, (req, res) => {
    aktivSetzen(null);
    protokolliere(req.session.benutzer, 'excel_geloescht', 'excel', null, `${titel} (aus der Anzeige genommen, Versionen bleiben)`);
    res.json({ success: true });
  });

  // Zuordnung der Spalten für die Übersicht "Wer ist im Gibeli?" (Name der Kopfzeilen-Spalte je Rolle)
  if (mitSpalten) {
    app.put(`${url}/spalten`, schreibRecht, (req, res) => {
      const eingabe = req.body || {};
      const sauber = {};
      for (const k of ['name', 'von', 'bis', 'personen']) {
        if (typeof eingabe[k] === 'string' && eingabe[k].trim()) sauber[k] = eingabe[k].trim().slice(0, 80);
      }
      speichere('spalten', Object.keys(sauber).length ? JSON.stringify(sauber) : '');
      protokolliere(req.session.benutzer, 'excel_spalten', 'excel', null, `${titel}: ${JSON.stringify(sauber)}`);
      res.json({ success: true, spalten: Object.keys(sauber).length ? sauber : null });
    });
  }

  app.post(`${url}/versionen/:id/aktivieren`, schreibRecht, (req, res) => {
    const v = db.prepare('SELECT * FROM excel_versionen WHERE id = ? AND bereich = ?').get(req.params.id, praefix);
    if (!v || !fs.existsSync(dateiPfad(v.dateipfad))) return res.status(404).json({ error: 'Version nicht gefunden' });
    aktivSetzen(v);
    protokolliere(req.session.benutzer, 'excel_version_aktiviert', 'excel', v.id, `${titel}: ${v.dateiname} (${v.hochgeladen_am})`);
    res.json({ success: true });
  });

  app.delete(`${url}/versionen/:id`, schreibRecht, (req, res) => {
    const v = db.prepare('SELECT * FROM excel_versionen WHERE id = ? AND bereich = ?').get(req.params.id, praefix);
    if (!v) return res.status(404).json({ error: 'Version nicht gefunden' });
    if (v.dateipfad === setting('dateipfad')?.wert) return res.status(400).json({ error: 'Die angezeigte Version kann nicht entfernt werden' });
    try { fs.unlinkSync(dateiPfad(v.dateipfad)); } catch (e) {}
    db.prepare('DELETE FROM excel_versionen WHERE id = ?').run(v.id);
    protokolliere(req.session.benutzer, 'excel_version_entfernt', 'excel', v.id, `${titel}: ${v.dateiname}`);
    res.json({ success: true });
  });
}

module.exports = function (app) {
  registriere(app, { url: '/api/belegung', dir: dirs.belegungDir, praefix: 'belegung', standardName: 'belegung.xlsx', titel: 'Aktuelle Belegung', schreibRecht: requireVerwaltung, schreibRollen: ['admin', 'verwaltung'], mitSpalten: true });
  registriere(app, { url: '/api/gerichte', dir: dirs.gerichteDir, praefix: 'gerichte', standardName: 'gerichte.xlsx', titel: 'Gerichte', schreibRecht: requireGerichte, schreibRollen: ['admin', 'gerichte'] });
};
