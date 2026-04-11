const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;
app.set('trust proxy', 1);

// ===== Paths (use env vars for Railway persistent volumes) =====
const dataDir = process.env.DATA_DIR || path.join(__dirname, 'data');
const uploadsDir = process.env.UPLOADS_DIR || path.join(__dirname, 'uploads');
const belegungDir = path.join(dataDir, 'belegung');
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });
if (!fs.existsSync(belegungDir)) fs.mkdirSync(belegungDir, { recursive: true });

// ===== Database =====
const db = new Database(path.join(dataDir, 'belege.db'));
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

// ===== Migrations (safe, idempotent) =====
const migrations = [
  `ALTER TABLE belege ADD COLUMN benutzer_id INTEGER NOT NULL DEFAULT 1`,
  `ALTER TABLE benutzer ADD COLUMN geburtsdatum TEXT`,
  `ALTER TABLE belege ADD COLUMN status TEXT NOT NULL DEFAULT 'ausstehend'`,
  `ALTER TABLE belege ADD COLUMN waehrung TEXT NOT NULL DEFAULT 'EUR'`,
  `ALTER TABLE belege ADD COLUMN geschaeft TEXT NOT NULL DEFAULT ''`,
  `ALTER TABLE belege ADD COLUMN kategorie TEXT NOT NULL DEFAULT 'Sonstiges'`,
  `ALTER TABLE belege ADD COLUMN belegnummer TEXT NOT NULL DEFAULT ''`,
];
for (const m of migrations) { try { db.exec(m); } catch (e) {} }

// Default settings
const defaultSettings = {
  kasse_geschlossen: '0',
  aktive_periode: '0',
  belegung_dateiname: '',
  belegung_dateipfad: '',
  belegung_hochgeladen_am: ''
};
for (const [k, v] of Object.entries(defaultSettings)) {
  db.prepare(`INSERT OR IGNORE INTO einstellungen (schluessel, wert) VALUES (?, ?)`).run(k, v);
}

// Migrate old role names
db.prepare(`UPDATE benutzer SET rolle = 'gibeli-gast' WHERE rolle NOT IN ('admin', 'gibeli-gast', 'verwaltung') AND instr(rolle, ',') = 0`).run();

// Ensure admin "Lio" exists
if (!db.prepare("SELECT id FROM benutzer WHERE benutzername = 'Lio'").get()) {
  const hash = bcrypt.hashSync('2202', 10);
  db.prepare("INSERT INTO benutzer (benutzername, passwort, rolle) VALUES ('Lio', ?, 'admin')").run(hash);
  console.log('Admin erstellt: Lio / 2202');
}
// Ensure admin "Admin2" exists
if (!db.prepare("SELECT id FROM benutzer WHERE benutzername = 'Admin2'").get()) {
  const h2 = bcrypt.hashSync('1111', 10);
  db.prepare("INSERT INTO benutzer (benutzername, passwort, rolle) VALUES ('Admin2', ?, 'admin')").run(h2);
  console.log('Admin erstellt: Admin2 / 1111');
}
// Ensure admin "Admin3" exists
if (!db.prepare("SELECT id FROM benutzer WHERE benutzername = 'Admin3'").get()) {
  const h3 = bcrypt.hashSync('1111', 10);
  db.prepare("INSERT INTO benutzer (benutzername, passwort, rolle) VALUES ('Admin3', ?, 'admin')").run(h3);
  console.log('Admin erstellt: Admin3 / 1111');
}

// ===== Helpers =====
function getRollen(user) {
  return (user.rolle || '').split(',').map(r => r.trim()).filter(Boolean);
}

function hatRolle(user, ...rollen) {
  const userRollen = getRollen(user);
  return rollen.some(r => userRollen.includes(r));
}

// ===== SQLite Session Store (survives server restarts) =====
db.exec(`CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  sess TEXT NOT NULL,
  expired_at INTEGER NOT NULL
)`);

class SQLiteStore extends session.Store {
  get(sid, cb) {
    try {
      const row = db.prepare('SELECT sess FROM sessions WHERE sid = ? AND expired_at > ?').get(sid, Date.now());
      cb(null, row ? JSON.parse(row.sess) : null);
    } catch(e) { cb(e); }
  }
  set(sid, sess, cb) {
    try {
      const exp = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 7*24*60*60*1000;
      db.prepare('INSERT OR REPLACE INTO sessions (sid, sess, expired_at) VALUES (?,?,?)').run(sid, JSON.stringify(sess), exp);
      cb(null);
    } catch(e) { cb(e); }
  }
  destroy(sid, cb) {
    try { db.prepare('DELETE FROM sessions WHERE sid = ?').run(sid); cb(null); }
    catch(e) { cb(e); }
  }
  touch(sid, sess, cb) {
    try {
      const exp = sess.cookie?.expires ? new Date(sess.cookie.expires).getTime() : Date.now() + 7*24*60*60*1000;
      db.prepare('UPDATE sessions SET expired_at = ? WHERE sid = ?').run(exp, sid);
      if (cb) cb(null);
    } catch(e) { if (cb) cb(e); }
  }
}
setInterval(() => db.prepare('DELETE FROM sessions WHERE expired_at <= ?').run(Date.now()), 3600000);

// ===== Session =====
app.use(session({
  store: new SQLiteStore(),
  secret: process.env.SESSION_SECRET || 'belegverwaltung-geheim-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 }
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ===== Auth Middleware =====
function requireLogin(req, res, next) {
  if (req.session && req.session.benutzer) return next();
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Nicht angemeldet' });
  res.redirect('/login.html');
}

function requireAdmin(req, res, next) {
  if (req.session?.benutzer && hatRolle(req.session.benutzer, 'admin')) return next();
  res.status(403).json({ error: 'Kein Admin-Zugriff' });
}

function requireVerwaltung(req, res, next) {
  if (req.session?.benutzer && hatRolle(req.session.benutzer, 'admin', 'verwaltung')) return next();
  res.status(403).json({ error: 'Kein Zugriff' });
}

// ===== Public static files =====
app.get('/login.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.html')));
app.get('/login.css', (req, res) => res.sendFile(path.join(__dirname, 'public', 'login.css')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));

// ===== AUTH ROUTES =====
app.post('/api/login', (req, res) => {
  const { benutzername, passwort, geburtsdatum } = req.body;
  if (!benutzername) return res.status(400).json({ error: 'Benutzername erforderlich' });

  const user = db.prepare('SELECT * FROM benutzer WHERE benutzername = ?').get(benutzername);
  if (!user) return res.status(401).json({ error: 'Falscher Benutzername oder Zugangsdaten' });

  const rollen = getRollen(user);
  if (rollen.includes('admin')) {
    if (!passwort || !bcrypt.compareSync(passwort, user.passwort))
      return res.status(401).json({ error: 'Falsches Passwort' });
  } else {
    if (!geburtsdatum || geburtsdatum !== user.geburtsdatum)
      return res.status(401).json({ error: 'Falsches Geburtsdatum' });
  }

  req.session.benutzer = { id: user.id, benutzername: user.benutzername, rolle: user.rolle };
  res.json({ rolle: user.rolle, benutzername: user.benutzername });
});

app.post('/api/logout', (req, res) => {
  req.session.destroy();
  res.json({ success: true });
});

app.get('/api/ich', requireLogin, (req, res) => {
  res.json(req.session.benutzer);
});

// ===== PUBLIC: Settings & Exchange Rate =====
app.get('/api/einstellungen', (req, res) => {
  const kasse = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='kasse_geschlossen'`).get();
  const periode = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='aktive_periode'`).get();
  const aktivePeriode = periode?.wert !== '0'
    ? db.prepare('SELECT * FROM perioden WHERE id = ?').get(parseInt(periode.wert))
    : null;
  res.json({ kasse_geschlossen: kasse?.wert === '1', aktive_periode: aktivePeriode || null });
});

app.get('/api/wechselkurs', async (req, res) => {
  try {
    const https = require('https');
    const data = await new Promise((resolve, reject) => {
      https.get('https://api.frankfurter.app/latest?from=EUR&to=CHF', r => {
        let body = '';
        r.on('data', d => body += d);
        r.on('end', () => resolve(JSON.parse(body)));
      }).on('error', reject);
    });
    res.json({ EUR_to_CHF: data.rates.CHF, CHF_to_EUR: +(1 / data.rates.CHF).toFixed(6) });
  } catch (e) {
    res.json({ EUR_to_CHF: 0.95, CHF_to_EUR: 1.053, fallback: true });
  }
});

// ===== Protected static files =====
app.use(requireLogin, express.static(path.join(__dirname, 'public')));
app.use('/uploads', requireLogin, express.static(uploadsDir));

// ===== ADMIN: USER MANAGEMENT =====
app.get('/api/admin/benutzer', requireAdmin, (req, res) => {
  const users = db.prepare('SELECT id, benutzername, rolle, geburtsdatum, erstellt_am FROM benutzer ORDER BY erstellt_am DESC').all();
  res.json(users);
});

app.post('/api/admin/benutzer', requireAdmin, (req, res) => {
  const { benutzername, geburtsdatum, rollen } = req.body;
  if (!benutzername || !geburtsdatum)
    return res.status(400).json({ error: 'Benutzername und Geburtsdatum erforderlich' });

  const existing = db.prepare('SELECT id FROM benutzer WHERE benutzername = ?').get(benutzername);
  if (existing) return res.status(400).json({ error: 'Benutzername bereits vergeben' });

  const rolleStr = Array.isArray(rollen) && rollen.length > 0
    ? rollen.filter(r => ['admin','gibeli-gast','verwaltung'].includes(r)).join(',')
    : 'gibeli-gast';

  const result = db.prepare(
    "INSERT INTO benutzer (benutzername, passwort, rolle, geburtsdatum) VALUES (?, '', ?, ?)"
  ).run(benutzername, rolleStr, geburtsdatum);
  res.status(201).json({ id: result.lastInsertRowid, benutzername, rolle: rolleStr });
});

app.put('/api/admin/benutzer/:id/rollen', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM benutzer WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  if (user.id === req.session.benutzer.id) return res.status(400).json({ error: 'Eigene Rollen nicht änderbar' });

  const { rollen } = req.body;
  if (!Array.isArray(rollen) || rollen.length === 0)
    return res.status(400).json({ error: 'Mindestens eine Rolle erforderlich' });

  const valid = ['admin', 'gibeli-gast', 'verwaltung'];
  const filtered = rollen.filter(r => valid.includes(r));
  if (filtered.length === 0) return res.status(400).json({ error: 'Ungültige Rollen' });

  db.prepare('UPDATE benutzer SET rolle = ? WHERE id = ?').run(filtered.join(','), req.params.id);
  res.json({ success: true, rolle: filtered.join(',') });
});

app.delete('/api/admin/benutzer/:id', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM benutzer WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  if (user.id === req.session.benutzer.id) return res.status(400).json({ error: 'Eigenen Account nicht löschbar' });
  db.prepare('DELETE FROM belege WHERE benutzer_id = ?').run(req.params.id);
  db.prepare('DELETE FROM benutzer WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===== ADMIN: RECEIPTS =====
app.get('/api/admin/belege', requireVerwaltung, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, u.benutzername FROM belege b
    JOIN benutzer u ON b.benutzer_id = u.id
    ORDER BY b.datum DESC
  `).all();
  res.json(rows);
});

app.put('/api/admin/belege/:id/status', requireVerwaltung, (req, res) => {
  const { status } = req.body;
  if (status !== 'ausstehend' && status !== 'eingetragen')
    return res.status(400).json({ error: 'Ungültiger Status' });
  const row = db.prepare('SELECT id FROM belege WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Beleg nicht gefunden' });
  db.prepare('UPDATE belege SET status = ? WHERE id = ?').run(status, req.params.id);
  res.json({ success: true, status });
});

app.get('/api/admin/statistiken', requireVerwaltung, (req, res) => {
  const gesamt = db.prepare(`
    SELECT COUNT(*) as anzahl,
           SUM(CASE WHEN waehrung='EUR' THEN betrag ELSE 0 END) as summe_eur,
           SUM(CASE WHEN waehrung='CHF' THEN betrag ELSE 0 END) as summe_chf
    FROM belege
  `).get();
  const nachBenutzer = db.prepare(`
    SELECT u.benutzername, COUNT(b.id) as anzahl, SUM(b.betrag) as summe
    FROM benutzer u LEFT JOIN belege b ON b.benutzer_id = u.id
    GROUP BY u.id ORDER BY summe DESC
  `).all();
  res.json({ gesamt, nachBenutzer });
});

// ===== ADMIN: KASSE =====
app.post('/api/admin/kasse', requireAdmin, (req, res) => {
  const { geschlossen } = req.body;
  db.prepare(`UPDATE einstellungen SET wert = ? WHERE schluessel = 'kasse_geschlossen'`).run(geschlossen ? '1' : '0');
  res.json({ success: true, kasse_geschlossen: !!geschlossen });
});

// ===== ADMIN: PERIODEN =====
app.get('/api/admin/perioden', requireAdmin, (req, res) => {
  const perioden = db.prepare('SELECT * FROM perioden ORDER BY von DESC').all();
  const aktive = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='aktive_periode'`).get();
  const aktiveId = parseInt(aktive?.wert || '0');
  const periodenMitStats = perioden.map(p => {
    const stats = db.prepare(`
      SELECT COUNT(*) as anzahl,
             SUM(CASE WHEN waehrung='EUR' THEN betrag ELSE 0 END) as summe_eur,
             SUM(CASE WHEN waehrung='CHF' THEN betrag ELSE 0 END) as summe_chf
      FROM belege WHERE datum >= ? AND datum <= ?
    `).get(p.von, p.bis);
    return Object.assign({}, p, { stats });
  });
  res.json({ perioden: periodenMitStats, aktive_periode_id: aktiveId });
});

app.post('/api/admin/perioden', requireAdmin, (req, res) => {
  const { name, von, bis } = req.body;
  if (!name || !von || !bis)
    return res.status(400).json({ error: 'Name, Von und Bis sind erforderlich' });
  if (von > bis)
    return res.status(400).json({ error: 'Startdatum muss vor Enddatum liegen' });
  const result = db.prepare('INSERT INTO perioden (name, von, bis) VALUES (?, ?, ?)').run(name, von, bis);
  res.status(201).json(db.prepare('SELECT * FROM perioden WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/admin/perioden/:id/aktivieren', requireAdmin, (req, res) => {
  const periode = db.prepare('SELECT * FROM perioden WHERE id = ?').get(req.params.id);
  if (!periode) return res.status(404).json({ error: 'Periode nicht gefunden' });
  db.prepare(`UPDATE einstellungen SET wert = ? WHERE schluessel = 'aktive_periode'`).run(String(req.params.id));
  db.prepare(`UPDATE einstellungen SET wert = '0' WHERE schluessel = 'kasse_geschlossen'`).run();
  res.json({ success: true, aktive_periode: periode });
});

app.delete('/api/admin/perioden/aktiv', requireAdmin, (req, res) => {
  db.prepare(`UPDATE einstellungen SET wert = '0' WHERE schluessel = 'aktive_periode'`).run();
  db.prepare(`UPDATE einstellungen SET wert = '1' WHERE schluessel = 'kasse_geschlossen'`).run();
  res.json({ success: true });
});

app.delete('/api/admin/perioden/:id', requireAdmin, (req, res) => {
  const periode = db.prepare('SELECT * FROM perioden WHERE id = ?').get(req.params.id);
  if (!periode) return res.status(404).json({ error: 'Periode nicht gefunden' });
  const aktive = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='aktive_periode'`).get();
  if (aktive?.wert === String(req.params.id)) {
    db.prepare(`UPDATE einstellungen SET wert = '0' WHERE schluessel = 'aktive_periode'`).run();
    db.prepare(`UPDATE einstellungen SET wert = '1' WHERE schluessel = 'kasse_geschlossen'`).run();
  }
  db.prepare('DELETE FROM perioden WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// ===== ADMIN: PROFIL =====
app.put('/api/admin/profil', requireAdmin, (req, res) => {
  const { benutzername, passwortAktuell, passwortNeu } = req.body;
  const userId = req.session.benutzer.id;
  const dbUser = db.prepare('SELECT * FROM benutzer WHERE id = ?').get(userId);
  if (!dbUser) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  if (!passwortAktuell || !bcrypt.compareSync(passwortAktuell, dbUser.passwort))
    return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
  const updates = [], params = [];
  if (benutzername && benutzername.trim() && benutzername.trim() !== dbUser.benutzername) {
    const exists = db.prepare('SELECT id FROM benutzer WHERE benutzername = ? AND id != ?').get(benutzername.trim(), userId);
    if (exists) return res.status(400).json({ error: 'Benutzername bereits vergeben' });
    updates.push('benutzername = ?'); params.push(benutzername.trim());
  }
  if (passwortNeu && passwortNeu.length >= 4) {
    updates.push('passwort = ?'); params.push(bcrypt.hashSync(passwortNeu, 10));
  }
  if (updates.length === 0)
    return res.status(400).json({ error: 'Bitte neuen Namen oder neues Passwort angeben' });
  params.push(userId);
  db.prepare(`UPDATE benutzer SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  if (benutzername && benutzername.trim() !== dbUser.benutzername)
    req.session.benutzer.benutzername = benutzername.trim();
  res.json({ success: true });
});

// ===== MULTER =====
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + path.extname(file.originalname));
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /jpeg|jpg|png|gif|webp|pdf/;
    if (allowed.test(path.extname(file.originalname).toLowerCase()) && allowed.test(file.mimetype))
      return cb(null, true);
    cb(new Error('Nur Bilder und PDF erlaubt'));
  }
});

// ===== MULTER: BELEGUNG (Excel) =====
const belegungStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, belegungDir),
  filename: (req, file, cb) => {
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, unique + path.extname(file.originalname));
  }
});
const uploadBelegung = multer({
  storage: belegungStorage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase();
    if (['.xlsx', '.xls', '.ods'].includes(ext)) return cb(null, true);
    cb(new Error('Nur Excel-Dateien (.xlsx, .xls, .ods) erlaubt'));
  }
});

// ===== BELEGUNG ROUTES =====
app.get('/api/belegung/datei', requireLogin, (req, res) => {
  const dateipfad = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='belegung_dateipfad'`).get();
  if (!dateipfad?.wert) return res.status(404).json({ error: 'Keine Datei vorhanden' });
  const filePath = path.join(belegungDir, dateipfad.wert);
  if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Datei nicht gefunden' });
  res.sendFile(filePath);
});

app.get('/api/belegung', requireLogin, (req, res) => {
  const dateiname = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='belegung_dateiname'`).get();
  const dateipfad = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='belegung_dateipfad'`).get();
  const hochgeladen = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='belegung_hochgeladen_am'`).get();
  if (!dateipfad?.wert) return res.json({ vorhanden: false });
  const filePath = path.join(belegungDir, dateipfad.wert);
  if (!fs.existsSync(filePath)) return res.json({ vorhanden: false });
  res.json({ vorhanden: true, dateiname: dateiname?.wert || 'belegung.xlsx', hochgeladen_am: hochgeladen?.wert || '' });
});

app.post('/api/belegung', requireVerwaltung, uploadBelegung.single('datei'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'Keine Datei hochgeladen' });
  const oldPath = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='belegung_dateipfad'`).get();
  if (oldPath?.wert) {
    const old = path.join(belegungDir, oldPath.wert);
    if (fs.existsSync(old)) try { fs.unlinkSync(old); } catch(e) {}
  }
  db.prepare(`INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('belegung_dateiname', ?)`).run(req.file.originalname);
  db.prepare(`INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('belegung_dateipfad', ?)`).run(req.file.filename);
  db.prepare(`INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('belegung_hochgeladen_am', ?)`).run(new Date().toISOString());
  res.json({ success: true, dateiname: req.file.originalname });
});

app.delete('/api/belegung', requireVerwaltung, (req, res) => {
  const dateipfad = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='belegung_dateipfad'`).get();
  if (dateipfad?.wert) {
    const filePath = path.join(belegungDir, dateipfad.wert);
    if (fs.existsSync(filePath)) try { fs.unlinkSync(filePath); } catch(e) {}
  }
  db.prepare(`INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('belegung_dateiname', '')`).run();
  db.prepare(`INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('belegung_dateipfad', '')`).run();
  db.prepare(`INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('belegung_hochgeladen_am', '')`).run();
  res.json({ success: true });
});

// ===== BELEGE ROUTES =====
app.get('/api/belege', requireLogin, (req, res) => {
  const { von, bis, suche } = req.query;
  const isPrivileged = hatRolle(req.session.benutzer, 'admin', 'verwaltung');
  let query = 'SELECT * FROM belege WHERE 1=1';
  const params = [];

  if (!isPrivileged) { query += ' AND benutzer_id = ?'; params.push(req.session.benutzer.id); }
  if (von) { query += ' AND datum >= ?'; params.push(von); }
  if (bis) { query += ' AND datum <= ?'; params.push(bis); }
  if (suche) { query += ' AND (geschaeft LIKE ? OR notiz LIKE ?)'; params.push(`%${suche}%`, `%${suche}%`); }

  query += ' ORDER BY datum DESC, erstellt_am DESC';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/belege/:id', requireLogin, (req, res) => {
  const row = db.prepare('SELECT * FROM belege WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Beleg nicht gefunden' });
  if (row.benutzer_id !== req.session.benutzer.id && !hatRolle(req.session.benutzer, 'admin', 'verwaltung'))
    return res.status(403).json({ error: 'Kein Zugriff' });
  res.json(row);
});

app.post('/api/belege', requireLogin, upload.single('datei'), (req, res) => {
  if (!hatRolle(req.session.benutzer, 'admin', 'verwaltung')) {
    const kasse = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='kasse_geschlossen'`).get();
    if (kasse?.wert === '1') {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Die Kasse ist geschlossen – keine Änderungen möglich' });
    }
  }
  const { datum, geschaeft, betrag, notiz, waehrung, belegnummer } = req.body;
  if (!datum || betrag === undefined || !req.file)
    return res.status(400).json({ error: 'Datum, Betrag und Datei sind Pflichtfelder' });
  if (!belegnummer || !/^\d{3}$/.test(belegnummer.trim())) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Bitte die letzten 3 Ziffern der Belegnummer angeben' });
  }

  const result = db.prepare(`
    INSERT INTO belege (benutzer_id, datum, geschaeft, betrag, notiz, dateiname, dateipfad, waehrung, belegnummer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.session.benutzer.id, datum, geschaeft || '', parseFloat(betrag),
    notiz || null, req.file.originalname, req.file.filename,
    waehrung === 'CHF' ? 'CHF' : 'EUR', belegnummer.trim()
  );
  res.status(201).json(db.prepare('SELECT * FROM belege WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/belege/:id', requireLogin, upload.single('datei'), (req, res) => {
  const existing = db.prepare('SELECT * FROM belege WHERE id = ?').get(req.params.id);
  if (!existing) { if (req.file) fs.unlinkSync(req.file.path); return res.status(404).json({ error: 'Nicht gefunden' }); }
  if (existing.benutzer_id !== req.session.benutzer.id && !hatRolle(req.session.benutzer, 'admin', 'verwaltung')) {
    if (req.file) fs.unlinkSync(req.file.path); return res.status(403).json({ error: 'Kein Zugriff' });
  }
  if (!hatRolle(req.session.benutzer, 'admin', 'verwaltung')) {
    const kasse = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='kasse_geschlossen'`).get();
    if (kasse?.wert === '1') {
      if (req.file) fs.unlinkSync(req.file.path);
      return res.status(403).json({ error: 'Die Kasse ist geschlossen – keine Änderungen möglich' });
    }
  }
  if (existing.status === 'eingetragen' && !hatRolle(req.session.benutzer, 'admin', 'verwaltung')) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(403).json({ error: 'Eingetragene Belege können nicht mehr bearbeitet werden' });
  }
  const { datum, geschaeft, betrag, notiz, waehrung, belegnummer } = req.body;
  let dateipfad = existing.dateipfad, dateiname = existing.dateiname;
  if (req.file) {
    if (existing.dateipfad) { const old = path.join(uploadsDir, existing.dateipfad); if (fs.existsSync(old)) fs.unlinkSync(old); }
    dateipfad = req.file.filename; dateiname = req.file.originalname;
  }
  db.prepare(`UPDATE belege SET datum=?,geschaeft=?,betrag=?,notiz=?,dateiname=?,dateipfad=?,waehrung=?,belegnummer=? WHERE id=?`)
    .run(datum||existing.datum, geschaeft!==undefined?geschaeft:existing.geschaeft,
      betrag!==undefined?parseFloat(betrag):existing.betrag,
      notiz!==undefined?notiz:existing.notiz,
      dateiname, dateipfad, waehrung||existing.waehrung,
      belegnummer!==undefined?belegnummer.trim():existing.belegnummer,
      req.params.id);
  res.json(db.prepare('SELECT * FROM belege WHERE id = ?').get(req.params.id));
});

app.delete('/api/belege/:id', requireLogin, (req, res) => {
  const row = db.prepare('SELECT * FROM belege WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });
  if (row.benutzer_id !== req.session.benutzer.id && !hatRolle(req.session.benutzer, 'admin', 'verwaltung'))
    return res.status(403).json({ error: 'Kein Zugriff' });
  if (!hatRolle(req.session.benutzer, 'admin', 'verwaltung')) {
    const kasse = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='kasse_geschlossen'`).get();
    if (kasse?.wert === '1') return res.status(403).json({ error: 'Die Kasse ist geschlossen – keine Änderungen möglich' });
  }
  if (row.dateipfad) { const p = path.join(uploadsDir, row.dateipfad); if (fs.existsSync(p)) fs.unlinkSync(p); }
  db.prepare('DELETE FROM belege WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/statistiken', requireLogin, (req, res) => {
  const uid = req.session.benutzer.id;
  const isPrivileged = hatRolle(req.session.benutzer, 'admin', 'verwaltung');
  const where = isPrivileged ? '' : 'WHERE benutzer_id = ?';
  const args = isPrivileged ? [] : [uid];
  const total = db.prepare(`
    SELECT COUNT(*) as anzahl,
           SUM(CASE WHEN waehrung='EUR' THEN betrag ELSE 0 END) as gesamt_eur,
           SUM(CASE WHEN waehrung='CHF' THEN betrag ELSE 0 END) as gesamt_chf
    FROM belege ${where}
  `).get(...args);
  const thisMonth = db.prepare(`
    SELECT COUNT(*) as anzahl,
           SUM(CASE WHEN waehrung='EUR' THEN betrag ELSE 0 END) as gesamt_eur,
           SUM(CASE WHEN waehrung='CHF' THEN betrag ELSE 0 END) as gesamt_chf
    FROM belege ${where ? where + ' AND' : 'WHERE'} strftime('%Y-%m', datum) = strftime('%Y-%m', 'now')
  `).get(...args);
  res.json({ gesamt: total, dieserMonat: thisMonth });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Belegverwaltung läuft auf http://localhost:${PORT}`);
  console.log(`Daten: ${dataDir} | Uploads: ${uploadsDir}`);
});
