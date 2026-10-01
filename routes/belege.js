// Belege: Erfassen (mit Foto-Scan), Bearbeiten, Papierkorb, Fotos, Export, Statistik
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const { db } = require('../lib/db');
const { dirs } = require('../lib/config');
const { hatRolle, istPrivilegiert, requireLogin, requireVerwaltung, requireAdmin } = require('../lib/auth');
const { protokolliere, diff } = require('../lib/protokoll');
const { scanneBeleg } = require('../scan');

const { uploadsDir, scanTmpDir } = dirs;
const PAPIERKORB_TAGE = 30;
const MAX_ZUSATZFOTOS = 5;

// ---------- Hilfen ----------
const loescheDatei = name => { if (name) try { fs.unlinkSync(path.join(uploadsDir, name)); } catch (e) {} };
function loescheUploads(req) {
  const f = req.files || {};
  for (const liste of Object.values(f)) for (const x of liste) try { fs.unlinkSync(x.path); } catch (e) {}
}
const kasseGeschlossen = () => db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='kasse_geschlossen'`).get()?.wert === '1';

function mitFotos(belege) {
  if (!belege.length) return belege;
  const ids = belege.map(b => b.id);
  const fotos = db.prepare(`SELECT id, beleg_id, dateiname, dateipfad FROM beleg_fotos WHERE beleg_id IN (${ids.map(() => '?').join(',')}) ORDER BY id`).all(...ids);
  const map = {};
  for (const f of fotos) (map[f.beleg_id] = map[f.beleg_id] || []).push({ id: f.id, dateiname: f.dateiname, dateipfad: f.dateipfad });
  return belege.map(b => ({ ...b, zusatzFotos: map[b.id] || [] }));
}

// ---------- Datei-Upload (normal) ----------
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadsDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase()}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024, files: 1 + MAX_ZUSATZFOTOS },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype)) return cb(null, true);
    cb(new Error('Nur Bilder und PDF erlaubt'));
  }
}).fields([{ name: 'datei', maxCount: 1 }, { name: 'zusatz', maxCount: MAX_ZUSATZFOTOS }]);

// ---------- Beleg-Scan (OCR) ----------
// Das Foto wird einmal hochgeladen (im Browser bereits komprimiert), serverseitig gelesen und kurz
// zwischengespeichert. Beim Speichern wird nur noch der scanToken geschickt (spart Upload bei langsamem Internet).
// "Verifiziert" wird ausschliesslich hier auf dem Server entschieden.
const scans = new Map();
const SCAN_TTL = 30 * 60 * 1000;

function raeumeScansAuf() {
  const jetzt = Date.now();
  for (const [token, e] of scans) if (e.ablauf < jetzt) { try { fs.unlinkSync(e.pfad); } catch (err) {} scans.delete(token); }
  try {
    for (const f of fs.readdirSync(scanTmpDir)) {
      const fp = path.join(scanTmpDir, f);
      if (jetzt - fs.statSync(fp).mtimeMs > 2 * 3600 * 1000) fs.unlinkSync(fp);
    }
  } catch (err) {}
}

const scanUpload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, scanTmpDir),
    filename: (req, file, cb) => cb(null, `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(file.originalname).toLowerCase() || '.jpg'}`)
  }),
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (/\.(jpe?g|png|webp)$/i.test(file.originalname) && /^image\/(jpeg|png|webp)$/.test(file.mimetype)) return cb(null, true);
    cb(new Error('Nur Fotos (JPG, PNG, WebP) können gelesen werden'));
  }
});

function nimmScan(token, userId) {
  const e = token && scans.get(String(token));
  if (!e || e.userId !== userId || e.ablauf < Date.now() || !fs.existsSync(e.pfad)) return null;
  scans.delete(String(token));
  const name = `${Date.now()}-${Math.round(Math.random() * 1e9)}${path.extname(e.pfad)}`;
  fs.renameSync(e.pfad, path.join(uploadsDir, name));
  return { filename: name, originalname: e.originalname, datum: e.datum, belegnummer: e.belegnummer, betrag: e.betrag, waehrung: e.waehrung, geschaeft: e.geschaeft };
}

const istVerifiziert = (scan, datum, nr) => !!(scan && scan.datum && scan.belegnummer && scan.datum === datum && scan.belegnummer === nr);

// Welche Felder stammen unverändert aus dem Foto? (Kennzeichnung für Admins)
function autoFelder(scan, w) {
  const gleich = (a, b) => a !== null && a !== undefined && a === b;
  return {
    auto_datum: scan && gleich(scan.datum, w.datum) ? 1 : 0,
    auto_belegnummer: scan && gleich(scan.belegnummer, w.belegnummer) ? 1 : 0,
    auto_betrag: scan && scan.betrag != null && Math.abs(scan.betrag - w.betrag) < 0.005 ? 1 : 0,
    auto_waehrung: scan && gleich(scan.waehrung, w.waehrung) ? 1 : 0,
    auto_geschaeft: scan && scan.geschaeft && gleich(scan.geschaeft.trim(), String(w.geschaeft || '').trim()) ? 1 : 0
  };
}

// ---------- Duplikate ----------
function findeDuplikat(datum, betrag, waehrung, belegnummer, ausserId) {
  return db.prepare(`SELECT b.id, b.datum, b.betrag, b.waehrung, b.belegnummer, b.benutzer_id FROM belege b
    WHERE b.geloescht_am IS NULL AND b.datum = ? AND ABS(b.betrag - ?) < 0.005 AND b.waehrung = ? AND b.belegnummer = ? AND b.id != ?
    LIMIT 1`).get(datum, betrag, waehrung, belegnummer, ausserId || 0);
}

// ---------- CSV ----------
function csvFeld(v) {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s; // Schutz vor Formel-Injection in Excel
  return /[;"\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

module.exports = function (app) {
  raeumeScansAuf();
  setInterval(raeumeScansAuf, 10 * 60 * 1000).unref();

  // Papierkorb automatisch leeren (nach 30 Tagen endgültig)
  function leerePapierkorb() {
    const alt = db.prepare(`SELECT id FROM belege WHERE geloescht_am IS NOT NULL AND geloescht_am < datetime('now', ?)`).all(`-${PAPIERKORB_TAGE} days`);
    for (const { id } of alt) endgueltigLoeschen(id, null, 'Papierkorb nach 30 Tagen geleert');
  }
  function endgueltigLoeschen(id, akteur, grund) {
    const b = db.prepare('SELECT * FROM belege WHERE id = ?').get(id);
    if (!b) return;
    loescheDatei(b.dateipfad);
    for (const f of db.prepare('SELECT dateipfad FROM beleg_fotos WHERE beleg_id = ?').all(id)) loescheDatei(f.dateipfad);
    db.prepare('DELETE FROM beleg_fotos WHERE beleg_id = ?').run(id);
    db.prepare('DELETE FROM belege WHERE id = ?').run(id);
    protokolliere(akteur, 'beleg_endgueltig_geloescht', 'beleg', id, `${grund || ''} ${b.datum} ${b.betrag} ${b.waehrung} Nr.${b.belegnummer}`.trim());
  }
  setInterval(leerePapierkorb, 6 * 3600 * 1000).unref();
  try { leerePapierkorb(); } catch (e) { console.error('Papierkorb:', e.message); }

  // ----- Foto-Auslieferung mit Besitzer-Prüfung -----
  app.get('/uploads/:name', requireLogin, (req, res) => {
    const name = path.basename(req.params.name);
    const b = db.prepare(`SELECT b.benutzer_id, b.geloescht_am FROM belege b WHERE b.dateipfad = ?
      UNION ALL SELECT b.benutzer_id, b.geloescht_am FROM beleg_fotos f JOIN belege b ON b.id = f.beleg_id WHERE f.dateipfad = ?`).get(name, name);
    const u = req.session.benutzer;
    const erlaubt = b && (istPrivilegiert(u) || (b.benutzer_id === u.id && !b.geloescht_am));
    if (!erlaubt) return res.status(b ? 403 : 404).json({ error: b ? 'Kein Zugriff' : 'Datei nicht gefunden' });
    const pfad = path.join(uploadsDir, name);
    if (!fs.existsSync(pfad)) return res.status(404).json({ error: 'Datei nicht gefunden' });
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.sendFile(pfad);
  });

  // ----- Scan -----
  app.post('/api/belege/scan', requireLogin, scanUpload.single('datei'), async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'Kein Foto hochgeladen' });
    const token = crypto.randomBytes(16).toString('hex');
    let erkannt = { datum: null, belegnummer: null, betrag: null, waehrung: null, geschaeft: null };
    let lesefehler = null, text = '';
    try {
      erkannt = await scanneBeleg(req.file.path);
      text = erkannt.text || '';
      console.log(`Scan: ${req.file.size} Bytes, ${text.length} Zeichen, Datum=${erkannt.datum}, Nr=${erkannt.belegnummer}, Betrag=${erkannt.betrag} ${erkannt.waehrung || ''}, Geschäft=${erkannt.geschaeft}`);
    } catch (e) {
      lesefehler = e.message === 'ausgelastet' ? 'ausgelastet' : 'fehlgeschlagen';
      text = 'Fehler: ' + e.message;
      console.error('Scan-Fehler:', e);
    }
    // Unvollständige Erkennung festhalten, damit die Erkennung später verbessert werden kann (nur Text, kein Foto)
    if (lesefehler || !erkannt.datum || !erkannt.belegnummer || erkannt.betrag == null) {
      protokolliere(req.session.benutzer, 'scan_unvollstaendig', 'scan', null,
        `Datum=${erkannt.datum} Nr=${erkannt.belegnummer} Betrag=${erkannt.betrag} ${erkannt.waehrung || ''} Geschäft=${erkannt.geschaeft}${lesefehler ? ' Fehler=' + lesefehler : ''}\n${text.slice(0, 900)}`);
    }
    scans.set(token, {
      userId: req.session.benutzer.id, pfad: req.file.path, originalname: req.file.originalname,
      datum: erkannt.datum, belegnummer: erkannt.belegnummer, betrag: erkannt.betrag, waehrung: erkannt.waehrung, geschaeft: erkannt.geschaeft,
      ablauf: Date.now() + SCAN_TTL
    });
    res.json({ scanToken: token, datum: erkannt.datum, belegnummer: erkannt.belegnummer, betrag: erkannt.betrag,
      waehrung: erkannt.waehrung, geschaeft: erkannt.geschaeft, lesefehler, text: text.slice(0, 1500) });
  });

  // ----- Liste / Einzelbeleg -----
  app.get('/api/belege', requireLogin, (req, res) => {
    const { von, bis, suche } = req.query;
    let query = 'SELECT * FROM belege WHERE geloescht_am IS NULL';
    const params = [];
    if (!istPrivilegiert(req.session.benutzer)) { query += ' AND benutzer_id = ?'; params.push(req.session.benutzer.id); }
    if (von) { query += ' AND datum >= ?'; params.push(von); }
    if (bis) { query += ' AND datum <= ?'; params.push(bis); }
    if (suche) { query += ' AND (geschaeft LIKE ? OR notiz LIKE ? OR belegnummer LIKE ?)'; params.push(`%${suche}%`, `%${suche}%`, `%${suche}%`); }
    query += ' ORDER BY datum DESC, erstellt_am DESC';
    res.json(mitFotos(db.prepare(query).all(...params)));
  });

  app.get('/api/belege/:id', requireLogin, (req, res) => {
    const row = db.prepare('SELECT * FROM belege WHERE id = ? AND geloescht_am IS NULL').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Beleg nicht gefunden' });
    if (row.benutzer_id !== req.session.benutzer.id && !istPrivilegiert(req.session.benutzer)) return res.status(403).json({ error: 'Kein Zugriff' });
    res.json(mitFotos([row])[0]);
  });

  // ----- Erstellen -----
  app.post('/api/belege', requireLogin, upload, (req, res) => {
    const u = req.session.benutzer;
    const hauptFile = req.files && req.files.datei && req.files.datei[0];
    const zusatz = (req.files && req.files.zusatz) || [];
    const abbruch = (status, error, extra) => { loescheUploads(req); return res.status(status).json({ error, ...extra }); };

    if (!istPrivilegiert(u) && kasseGeschlossen()) return abbruch(403, 'Die Kasse ist geschlossen – keine Änderungen möglich');
    const { datum, geschaeft, betrag, notiz, waehrung, belegnummer, scanToken, clientId, duplikatOk } = req.body;

    // Idempotent: wurde derselbe Beleg (clientId) schon gespeichert (z.B. Antwort ging bei schlechtem Netz verloren)?
    if (clientId) {
      const vorhanden = db.prepare('SELECT * FROM belege WHERE benutzer_id = ? AND client_id = ?').get(u.id, String(clientId));
      if (vorhanden) { loescheUploads(req); return res.status(200).json(mitFotos([vorhanden])[0]); }
    }

    const nr = (belegnummer || '').trim();
    if (!datum || betrag === undefined || isNaN(parseFloat(betrag))) return abbruch(400, 'Datum, Betrag und Datei sind Pflichtfelder');
    if (!/^\d{3}$/.test(nr)) return abbruch(400, 'Bitte die letzten 3 Ziffern der Belegnummer angeben');
    const waehrungNeu = waehrung === 'CHF' ? 'CHF' : 'EUR';
    const betragZahl = parseFloat(betrag);

    // Doppelte Belege erkennen (vor dem Verbrauch des Scans, damit ein erneuter Versuch möglich bleibt)
    if (!duplikatOk) {
      const d = findeDuplikat(datum, betragZahl, waehrungNeu, nr);
      if (d) {
        loescheUploads(req);
        return res.status(409).json({ duplikat: true,
          error: `Möglicherweise doppelt: Es gibt schon einen Beleg vom ${d.datum} über ${d.betrag.toFixed(2)} ${d.waehrung} mit Nr. …${d.belegnummer}${d.benutzer_id === u.id ? ' (von dir)' : ' (von einem anderen Benutzer)'}.` });
      }
    }

    const scan = !hauptFile ? nimmScan(scanToken, u.id) : null;
    const datei = hauptFile ? { filename: hauptFile.filename, originalname: hauptFile.originalname } : scan;
    if (!datei) return abbruch(400, 'Datum, Betrag und Datei sind Pflichtfelder');

    const af = autoFelder(scan, { datum, belegnummer: nr, betrag: betragZahl, waehrung: waehrungNeu, geschaeft });
    const verifiziert = istVerifiziert(scan, datum, nr) ? 1 : 0;
    let id;
    try {
      const result = db.prepare(`
        INSERT INTO belege (benutzer_id, datum, geschaeft, betrag, notiz, dateiname, dateipfad, waehrung, belegnummer, verifiziert,
                            auto_datum, auto_belegnummer, auto_betrag, auto_waehrung, auto_geschaeft, client_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(u.id, datum, geschaeft || '', betragZahl, notiz || null, datei.originalname, datei.filename, waehrungNeu, nr, verifiziert,
        af.auto_datum, af.auto_belegnummer, af.auto_betrag, af.auto_waehrung, af.auto_geschaeft, clientId ? String(clientId) : null);
      id = result.lastInsertRowid;
    } catch (e) {
      if (scan) loescheDatei(scan.filename);
      loescheUploads(req);
      if (/UNIQUE/.test(e.message) && clientId) {
        const vorhanden = db.prepare('SELECT * FROM belege WHERE benutzer_id = ? AND client_id = ?').get(u.id, String(clientId));
        if (vorhanden) return res.status(200).json(mitFotos([vorhanden])[0]);
      }
      throw e;
    }
    for (const z of zusatz) db.prepare('INSERT INTO beleg_fotos (beleg_id, dateiname, dateipfad) VALUES (?, ?, ?)').run(id, z.originalname, z.filename);
    protokolliere(u, 'beleg_erstellt', 'beleg', id,
      `${datum} ${betragZahl.toFixed(2)} ${waehrungNeu} Nr.${nr} ${geschaeft || ''} | ${verifiziert ? 'verifiziert' : 'manuell'}${zusatz.length ? ` | +${zusatz.length} Foto(s)` : ''}`);
    res.status(201).json(mitFotos([db.prepare('SELECT * FROM belege WHERE id = ?').get(id)])[0]);
  });

  // ----- Bearbeiten -----
  app.put('/api/belege/:id', requireLogin, upload, (req, res) => {
    const u = req.session.benutzer;
    const abbruch = (status, error) => { loescheUploads(req); return res.status(status).json({ error }); };
    const existing = db.prepare('SELECT * FROM belege WHERE id = ? AND geloescht_am IS NULL').get(req.params.id);
    if (!existing) return abbruch(404, 'Nicht gefunden');
    if (existing.benutzer_id !== u.id && !istPrivilegiert(u)) return abbruch(403, 'Kein Zugriff');
    if (!istPrivilegiert(u) && kasseGeschlossen()) return abbruch(403, 'Die Kasse ist geschlossen – keine Änderungen möglich');
    if (existing.status === 'eingetragen' && !istPrivilegiert(u)) return abbruch(403, 'Eingetragene Belege können nicht mehr bearbeitet werden');

    const hauptFile = req.files && req.files.datei && req.files.datei[0];
    const zusatz = (req.files && req.files.zusatz) || [];
    const { datum, geschaeft, betrag, notiz, waehrung, belegnummer, scanToken, entferneFotos, duplikatOk } = req.body;
    const neuDatum = datum || existing.datum;
    const neuNummer = belegnummer !== undefined ? belegnummer.trim() : existing.belegnummer;
    const neuBetrag = betrag !== undefined ? parseFloat(betrag) : existing.betrag;
    const neuWaehrung = waehrung || existing.waehrung;
    const neuGeschaeft = geschaeft !== undefined ? geschaeft : existing.geschaeft;
    if (belegnummer !== undefined && !/^\d{3}$/.test(neuNummer)) return abbruch(400, 'Bitte die letzten 3 Ziffern der Belegnummer angeben');
    if (isNaN(neuBetrag)) return abbruch(400, 'Ungültiger Betrag');

    if (!duplikatOk && (neuDatum !== existing.datum || neuNummer !== existing.belegnummer || Math.abs(neuBetrag - existing.betrag) > 0.004 || neuWaehrung !== existing.waehrung)) {
      const d = findeDuplikat(neuDatum, neuBetrag, neuWaehrung, neuNummer, existing.id);
      if (d) {
        loescheUploads(req);
        return res.status(409).json({ duplikat: true, error: `Möglicherweise doppelt: Es gibt schon einen Beleg vom ${d.datum} über ${d.betrag.toFixed(2)} ${d.waehrung} mit Nr. …${d.belegnummer}.` });
      }
    }

    // Automatisch gelesene Felder bleiben nur markiert, solange der Wert unverändert ist
    let af = {
      auto_datum: existing.auto_datum && neuDatum === existing.datum ? 1 : 0,
      auto_belegnummer: existing.auto_belegnummer && neuNummer === existing.belegnummer ? 1 : 0,
      auto_betrag: existing.auto_betrag && Math.abs(neuBetrag - existing.betrag) < 0.005 ? 1 : 0,
      auto_waehrung: existing.auto_waehrung && neuWaehrung === existing.waehrung ? 1 : 0,
      auto_geschaeft: existing.auto_geschaeft && neuGeschaeft === existing.geschaeft ? 1 : 0
    };
    let verifiziert = existing.verifiziert && neuDatum === existing.datum && neuNummer === existing.belegnummer ? 1 : 0;
    let dateipfad = existing.dateipfad, dateiname = existing.dateiname;
    const scan = !hauptFile ? nimmScan(scanToken, u.id) : null;
    if (hauptFile || scan) {
      loescheDatei(existing.dateipfad);
      dateipfad = hauptFile ? hauptFile.filename : scan.filename;
      dateiname = hauptFile ? hauptFile.originalname : scan.originalname;
      verifiziert = istVerifiziert(scan, neuDatum, neuNummer) ? 1 : 0;
      af = autoFelder(scan, { datum: neuDatum, belegnummer: neuNummer, betrag: neuBetrag, waehrung: neuWaehrung, geschaeft: neuGeschaeft });
    }
    db.prepare(`UPDATE belege SET datum=?,geschaeft=?,betrag=?,notiz=?,dateiname=?,dateipfad=?,waehrung=?,belegnummer=?,verifiziert=?,
                auto_datum=?,auto_belegnummer=?,auto_betrag=?,auto_waehrung=?,auto_geschaeft=? WHERE id=?`)
      .run(neuDatum, neuGeschaeft, neuBetrag, notiz !== undefined ? notiz : existing.notiz, dateiname, dateipfad, neuWaehrung, neuNummer, verifiziert,
        af.auto_datum, af.auto_belegnummer, af.auto_betrag, af.auto_waehrung, af.auto_geschaeft, existing.id);

    // Zusatzfotos entfernen / hinzufügen
    let fotoInfo = '';
    if (entferneFotos) {
      let ids = [];
      try { ids = JSON.parse(entferneFotos); } catch (e) {}
      for (const fid of Array.isArray(ids) ? ids : []) {
        const f = db.prepare('SELECT * FROM beleg_fotos WHERE id = ? AND beleg_id = ?').get(fid, existing.id);
        if (f) { loescheDatei(f.dateipfad); db.prepare('DELETE FROM beleg_fotos WHERE id = ?').run(f.id); fotoInfo += ' Foto entfernt;'; }
      }
    }
    const anzahl = db.prepare('SELECT COUNT(*) n FROM beleg_fotos WHERE beleg_id = ?').get(existing.id).n;
    zusatz.forEach((z, i) => {
      if (anzahl + i < MAX_ZUSATZFOTOS) { db.prepare('INSERT INTO beleg_fotos (beleg_id, dateiname, dateipfad) VALUES (?, ?, ?)').run(existing.id, z.originalname, z.filename); fotoInfo += ' Foto hinzugefügt;'; }
      else loescheDatei(z.filename);
    });
    const neu = db.prepare('SELECT * FROM belege WHERE id = ?').get(existing.id);
    const aenderungen = diff(existing, neu, ['datum', 'geschaeft', 'betrag', 'waehrung', 'belegnummer', 'notiz', 'dateiname']);
    protokolliere(u, 'beleg_geaendert', 'beleg', existing.id, `${aenderungen}${fotoInfo ? ' |' + fotoInfo : ''}${existing.verifiziert && !neu.verifiziert ? ' | Verifizierung entfallen' : ''}`.trim() || 'keine Feldänderung');
    res.json(mitFotos([neu])[0]);
  });

  // ----- Löschen = Papierkorb -----
  app.delete('/api/belege/:id', requireLogin, (req, res) => {
    const u = req.session.benutzer;
    const row = db.prepare('SELECT * FROM belege WHERE id = ? AND geloescht_am IS NULL').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Nicht gefunden' });
    if (row.benutzer_id !== u.id && !istPrivilegiert(u)) return res.status(403).json({ error: 'Kein Zugriff' });
    if (!istPrivilegiert(u) && kasseGeschlossen()) return res.status(403).json({ error: 'Die Kasse ist geschlossen – keine Änderungen möglich' });
    db.prepare(`UPDATE belege SET geloescht_am = datetime('now'), geloescht_von = ? WHERE id = ?`).run(u.benutzername, row.id);
    protokolliere(u, 'beleg_geloescht', 'beleg', row.id, `${row.datum} ${row.betrag} ${row.waehrung} Nr.${row.belegnummer} (Papierkorb)`);
    res.json({ success: true, papierkorb: true });
  });

  // ----- Papierkorb (Admin/Verwaltung) -----
  app.get('/api/papierkorb', requireVerwaltung, (req, res) => {
    const rows = db.prepare(`SELECT b.*, u.benutzername FROM belege b LEFT JOIN benutzer u ON u.id = b.benutzer_id
      WHERE b.geloescht_am IS NOT NULL ORDER BY b.geloescht_am DESC`).all();
    res.json(rows.map(r => ({ ...r, benutzername: r.benutzername || '(gelöschter Benutzer)',
      verbleibendeTage: Math.max(0, PAPIERKORB_TAGE - Math.floor((Date.now() - new Date(r.geloescht_am.replace(' ', 'T') + 'Z').getTime()) / 86400000)) })));
  });

  app.post('/api/papierkorb/:id/wiederherstellen', requireVerwaltung, (req, res) => {
    const b = db.prepare('SELECT * FROM belege WHERE id = ? AND geloescht_am IS NOT NULL').get(req.params.id);
    if (!b) return res.status(404).json({ error: 'Beleg nicht im Papierkorb' });
    const besitzerDa = db.prepare('SELECT id FROM benutzer WHERE id = ?').get(b.benutzer_id);
    // Gehörte der Beleg einem inzwischen gelöschten Benutzer, geht er an den wiederherstellenden Admin
    db.prepare('UPDATE belege SET geloescht_am = NULL, geloescht_von = NULL, benutzer_id = ? WHERE id = ?')
      .run(besitzerDa ? b.benutzer_id : req.session.benutzer.id, b.id);
    protokolliere(req.session.benutzer, 'beleg_wiederhergestellt', 'beleg', b.id, `${b.datum} ${b.betrag} ${b.waehrung} Nr.${b.belegnummer}${besitzerDa ? '' : ' (Besitzer existiert nicht mehr, Beleg gehört jetzt dir)'}`);
    res.json({ success: true });
  });

  app.delete('/api/papierkorb/:id', requireAdmin, (req, res) => {
    const b = db.prepare('SELECT id FROM belege WHERE id = ? AND geloescht_am IS NOT NULL').get(req.params.id);
    if (!b) return res.status(404).json({ error: 'Beleg nicht im Papierkorb' });
    endgueltigLoeschen(b.id, req.session.benutzer, 'manuell');
    res.json({ success: true });
  });

  // ----- Statistik -----
  app.get('/api/statistiken', requireLogin, (req, res) => {
    const privil = istPrivilegiert(req.session.benutzer);
    const where = privil ? 'WHERE geloescht_am IS NULL' : 'WHERE geloescht_am IS NULL AND benutzer_id = ?';
    const args = privil ? [] : [req.session.benutzer.id];
    const summen = `COUNT(*) as anzahl,
      SUM(CASE WHEN waehrung='EUR' THEN betrag ELSE 0 END) as gesamt_eur,
      SUM(CASE WHEN waehrung='CHF' THEN betrag ELSE 0 END) as gesamt_chf`;
    const total = db.prepare(`SELECT ${summen} FROM belege ${where}`).get(...args);
    const thisMonth = db.prepare(`SELECT ${summen} FROM belege ${where} AND strftime('%Y-%m', datum) = strftime('%Y-%m', 'now')`).get(...args);
    let periode = null;
    const aktivId = parseInt(db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='aktive_periode'`).get()?.wert || '0');
    const p = aktivId ? db.prepare('SELECT * FROM perioden WHERE id = ?').get(aktivId) : null;
    if (p) {
      const stats = db.prepare(`SELECT ${summen} FROM belege ${where} AND datum >= ? AND datum <= ?`).get(...args, p.von, p.bis);
      periode = { name: p.name, von: p.von, bis: p.bis, ...stats };
    }
    res.json({ gesamt: total, dieserMonat: thisMonth, periode });
  });

  // ----- Export für die Buchhaltung (CSV, öffnet direkt in Excel) -----
  app.get('/api/export/belege.csv', requireVerwaltung, (req, res) => {
    const { von, bis } = req.query;
    const komma = req.query.dezimal === 'komma';
    let q = `SELECT b.*, u.benutzername FROM belege b LEFT JOIN benutzer u ON u.id = b.benutzer_id WHERE b.geloescht_am IS NULL`;
    const p = [];
    if (von) { q += ' AND b.datum >= ?'; p.push(von); }
    if (bis) { q += ' AND b.datum <= ?'; p.push(bis); }
    q += ' ORDER BY b.datum, b.id';
    const rows = db.prepare(q).all(...p);
    const zahl = n => (komma ? n.toFixed(2).replace('.', ',') : n.toFixed(2));
    const kopf = ['Datum', 'Beleg-Nr (letzte 3)', 'Benutzer', 'Geschäft', 'Betrag', 'Währung', 'Status', 'Verifiziert', 'Automatisch gelesen', 'Notiz', 'Fotos', 'Erfasst am'];
    const zeilen = [kopf.join(';')];
    const fotosAnzahl = Object.fromEntries(db.prepare('SELECT beleg_id, COUNT(*) n FROM beleg_fotos GROUP BY beleg_id').all().map(r => [r.beleg_id, r.n]));
    let sumEur = 0, sumChf = 0;
    for (const b of rows) {
      const auto = [b.auto_datum && 'Datum', b.auto_belegnummer && 'Nr', b.auto_betrag && 'Betrag', b.auto_waehrung && 'Währung', b.auto_geschaeft && 'Geschäft'].filter(Boolean).join(', ');
      if (b.waehrung === 'CHF') sumChf += b.betrag; else sumEur += b.betrag;
      zeilen.push([b.datum, b.belegnummer, b.benutzername || '(gelöscht)', b.geschaeft, zahl(b.betrag), b.waehrung, b.status === 'eingetragen' ? 'eingetragen' : 'ausstehend',
        b.verifiziert ? 'ja' : 'nein', auto, b.notiz, (b.dateipfad ? 1 : 0) + (fotosAnzahl[b.id] || 0), b.erstellt_am].map(csvFeld).join(';'));
    }
    zeilen.push('');
    zeilen.push(['', '', '', 'Summe EUR', zahl(sumEur), 'EUR'].map(csvFeld).join(';'));
    zeilen.push(['', '', '', 'Summe CHF', zahl(sumChf), 'CHF'].map(csvFeld).join(';'));
    protokolliere(req.session.benutzer, 'export', 'export', null, `${von || '…'} bis ${bis || '…'}: ${rows.length} Belege`);
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="belege-${(von || 'alle')}_${(bis || 'alle')}.csv"`);
    res.send('﻿' + zeilen.join('\r\n') + '\r\n');
  });
};
