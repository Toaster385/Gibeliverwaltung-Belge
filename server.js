const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const session = require('express-session');
const bcrypt = require('bcryptjs');

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure directories exist
const uploadsDir = path.join(__dirname, 'uploads');
const dbDir = path.join(__dirname, 'data');
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir);

// Database setup
const db = new Database(path.join(dbDir, 'belege.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS benutzer (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benutzername TEXT UNIQUE NOT NULL,
    passwort TEXT NOT NULL,
    rolle TEXT NOT NULL DEFAULT 'benutzer',
    erstellt_am TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS belege (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    benutzer_id INTEGER NOT NULL DEFAULT 1,
    datum TEXT NOT NULL,
    geschaeft TEXT NOT NULL,
    betrag REAL NOT NULL,
    kategorie TEXT NOT NULL,
    notiz TEXT,
    dateiname TEXT,
    dateipfad TEXT,
    erstellt_am TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (benutzer_id) REFERENCES benutzer(id)
  )
`);

// Migrate existing receipts: add benutzer_id column if missing
try {
  db.exec(`ALTER TABLE belege ADD COLUMN benutzer_id INTEGER NOT NULL DEFAULT 1`);
} catch (e) { /* column already exists */ }

// Create default admin if not exists
const adminExists = db.prepare("SELECT id FROM benutzer WHERE rolle = 'admin' LIMIT 1").get();
if (!adminExists) {
  const hash = bcrypt.hashSync('admin123', 10);
  db.prepare("INSERT INTO benutzer (benutzername, passwort, rolle) VALUES (?, ?, 'admin')").run('admin', hash);
  console.log('Standard-Admin erstellt: admin / admin123');
}

// Session middleware
app.use(session({
  secret: process.env.SESSION_SECRET || 'belegverwaltung-geheim-2024',
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000 } // 7 days
}));

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Auth middleware
function requireLogin(req, res, next) {
  if (req.session && req.session.benutzer) return next();
  res.redirect('/login.html');
}

function requireAdmin(req, res, next) {
  if (req.session && req.session.benutzer && req.session.benutzer.rolle === 'admin') return next();
  res.status(403).json({ error: 'Kein Admin-Zugriff' });
}

// Static files (login page is public, rest requires login)
app.use('/login.html', express.static(path.join(__dirname, 'public', 'login.html')));
app.use('/login.css', express.static(path.join(__dirname, 'public', 'login.css')));

// Protected static files
app.use(requireLogin, express.static(path.join(__dirname, 'public')));
app.use('/uploads', requireLogin, express.static(uploadsDir));

// ===== AUTH ROUTES =====
app.post('/api/login', (req, res) => {
  const { benutzername, passwort } = req.body;
  if (!benutzername || !passwort)
    return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });

  const user = db.prepare('SELECT * FROM benutzer WHERE benutzername = ?').get(benutzername);
  if (!user || !bcrypt.compareSync(passwort, user.passwort))
    return res.status(401).json({ error: 'Falscher Benutzername oder Passwort' });

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

// ===== ADMIN ROUTES =====
app.get('/api/admin/benutzer', requireAdmin, (req, res) => {
  const users = db.prepare("SELECT id, benutzername, rolle, erstellt_am FROM benutzer ORDER BY erstellt_am DESC").all();
  res.json(users);
});

app.post('/api/admin/benutzer', requireAdmin, (req, res) => {
  const { benutzername, passwort, rolle } = req.body;
  if (!benutzername || !passwort)
    return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });

  const existing = db.prepare('SELECT id FROM benutzer WHERE benutzername = ?').get(benutzername);
  if (existing) return res.status(400).json({ error: 'Benutzername bereits vergeben' });

  const hash = bcrypt.hashSync(passwort, 10);
  const result = db.prepare("INSERT INTO benutzer (benutzername, passwort, rolle) VALUES (?, ?, ?)").run(
    benutzername, hash, rolle === 'admin' ? 'admin' : 'benutzer'
  );
  res.status(201).json({ id: result.lastInsertRowid, benutzername, rolle: rolle || 'benutzer' });
});

app.delete('/api/admin/benutzer/:id', requireAdmin, (req, res) => {
  const user = db.prepare('SELECT * FROM benutzer WHERE id = ?').get(req.params.id);
  if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
  if (user.id === req.session.benutzer.id) return res.status(400).json({ error: 'Eigenen Account nicht löschbar' });
  db.prepare('DELETE FROM benutzer WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/admin/belege', requireAdmin, (req, res) => {
  const rows = db.prepare(`
    SELECT b.*, u.benutzername FROM belege b
    JOIN benutzer u ON b.benutzer_id = u.id
    ORDER BY b.datum DESC
  `).all();
  res.json(rows);
});

app.get('/api/admin/statistiken', requireAdmin, (req, res) => {
  const gesamt = db.prepare('SELECT COUNT(*) as anzahl, SUM(betrag) as summe FROM belege').get();
  const nachBenutzer = db.prepare(`
    SELECT u.benutzername, COUNT(b.id) as anzahl, SUM(b.betrag) as summe
    FROM benutzer u LEFT JOIN belege b ON b.benutzer_id = u.id
    GROUP BY u.id ORDER BY summe DESC
  `).all();
  res.json({ gesamt, nachBenutzer });
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
    const ext = allowed.test(path.extname(file.originalname).toLowerCase());
    const mime = allowed.test(file.mimetype);
    if (ext && mime) return cb(null, true);
    cb(new Error('Nur Bilder und PDF erlaubt'));
  }
});

// ===== BELEGE ROUTES =====
app.get('/api/belege', requireLogin, (req, res) => {
  const { kategorie, von, bis, suche } = req.query;
  const isAdmin = req.session.benutzer.rolle === 'admin';
  let query = 'SELECT * FROM belege WHERE 1=1';
  const params = [];

  if (!isAdmin) {
    query += ' AND benutzer_id = ?';
    params.push(req.session.benutzer.id);
  }
  if (kategorie && kategorie !== 'alle') { query += ' AND kategorie = ?'; params.push(kategorie); }
  if (von) { query += ' AND datum >= ?'; params.push(von); }
  if (bis) { query += ' AND datum <= ?'; params.push(bis); }
  if (suche) { query += ' AND (geschaeft LIKE ? OR notiz LIKE ?)'; params.push(`%${suche}%`, `%${suche}%`); }

  query += ' ORDER BY datum DESC, erstellt_am DESC';
  res.json(db.prepare(query).all(...params));
});

app.get('/api/belege/:id', requireLogin, (req, res) => {
  const row = db.prepare('SELECT * FROM belege WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Beleg nicht gefunden' });
  if (row.benutzer_id !== req.session.benutzer.id && req.session.benutzer.rolle !== 'admin')
    return res.status(403).json({ error: 'Kein Zugriff' });
  res.json(row);
});

app.post('/api/belege', requireLogin, upload.single('datei'), (req, res) => {
  const { datum, geschaeft, betrag, kategorie, notiz } = req.body;
  if (!datum || !geschaeft || betrag === undefined || !kategorie) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Pflichtfelder fehlen' });
  }
  const result = db.prepare(`
    INSERT INTO belege (benutzer_id, datum, geschaeft, betrag, kategorie, notiz, dateiname, dateipfad)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(req.session.benutzer.id, datum, geschaeft, parseFloat(betrag), kategorie,
    notiz || null, req.file ? req.file.originalname : null, req.file ? req.file.filename : null);
  res.status(201).json(db.prepare('SELECT * FROM belege WHERE id = ?').get(result.lastInsertRowid));
});

app.put('/api/belege/:id', requireLogin, upload.single('datei'), (req, res) => {
  const existing = db.prepare('SELECT * FROM belege WHERE id = ?').get(req.params.id);
  if (!existing) { if (req.file) fs.unlinkSync(req.file.path); return res.status(404).json({ error: 'Nicht gefunden' }); }
  if (existing.benutzer_id !== req.session.benutzer.id && req.session.benutzer.rolle !== 'admin') {
    if (req.file) fs.unlinkSync(req.file.path); return res.status(403).json({ error: 'Kein Zugriff' });
  }
  const { datum, geschaeft, betrag, kategorie, notiz } = req.body;
  let dateipfad = existing.dateipfad, dateiname = existing.dateiname;
  if (req.file) {
    if (existing.dateipfad) { const old = path.join(uploadsDir, existing.dateipfad); if (fs.existsSync(old)) fs.unlinkSync(old); }
    dateipfad = req.file.filename; dateiname = req.file.originalname;
  }
  db.prepare(`UPDATE belege SET datum=?,geschaeft=?,betrag=?,kategorie=?,notiz=?,dateiname=?,dateipfad=? WHERE id=?`)
    .run(datum||existing.datum, geschaeft||existing.geschaeft,
      betrag!==undefined?parseFloat(betrag):existing.betrag,
      kategorie||existing.kategorie, notiz!==undefined?notiz:existing.notiz,
      dateiname, dateipfad, req.params.id);
  res.json(db.prepare('SELECT * FROM belege WHERE id = ?').get(req.params.id));
});

app.delete('/api/belege/:id', requireLogin, (req, res) => {
  const row = db.prepare('SELECT * FROM belege WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Nicht gefunden' });
  if (row.benutzer_id !== req.session.benutzer.id && req.session.benutzer.rolle !== 'admin')
    return res.status(403).json({ error: 'Kein Zugriff' });
  if (row.dateipfad) { const p = path.join(uploadsDir, row.dateipfad); if (fs.existsSync(p)) fs.unlinkSync(p); }
  db.prepare('DELETE FROM belege WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

app.get('/api/statistiken', requireLogin, (req, res) => {
  const uid = req.session.benutzer.id;
  const isAdmin = req.session.benutzer.rolle === 'admin';
  const where = isAdmin ? '' : 'WHERE benutzer_id = ?';
  const args = isAdmin ? [] : [uid];
  const total = db.prepare(`SELECT COUNT(*) as anzahl, SUM(betrag) as gesamt FROM belege ${where}`).get(...args);
  const byCategory = db.prepare(`SELECT kategorie, COUNT(*) as anzahl, SUM(betrag) as gesamt FROM belege ${where} GROUP BY kategorie ORDER BY gesamt DESC`).all(...args);
  const thisMonth = db.prepare(`SELECT COUNT(*) as anzahl, SUM(betrag) as gesamt FROM belege ${where ? where + ' AND' : 'WHERE'} strftime('%Y-%m', datum) = strftime('%Y-%m', 'now')`).get(...args);
  res.json({ gesamt: total, dieserMonat: thisMonth, nachKategorie: byCategory });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Belegverwaltung laeuft auf http://localhost:${PORT}`);
});
