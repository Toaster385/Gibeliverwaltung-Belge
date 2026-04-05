const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

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
  CREATE TABLE IF NOT EXISTS belege (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    datum TEXT NOT NULL,
    geschaeft TEXT NOT NULL,
    betrag REAL NOT NULL,
    kategorie TEXT NOT NULL,
    notiz TEXT,
    dateiname TEXT,
    dateipfad TEXT,
    erstellt_am TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Multer config
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
    cb(new Error('Nur Bilder (JPG, PNG, GIF, WEBP) und PDF erlaubt'));
  }
});

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use('/uploads', express.static(uploadsDir));

// GET all receipts
app.get('/api/belege', (req, res) => {
  const { kategorie, von, bis, suche } = req.query;
  let query = 'SELECT * FROM belege WHERE 1=1';
  const params = [];

  if (kategorie && kategorie !== 'alle') {
    query += ' AND kategorie = ?';
    params.push(kategorie);
  }
  if (von) {
    query += ' AND datum >= ?';
    params.push(von);
  }
  if (bis) {
    query += ' AND datum <= ?';
    params.push(bis);
  }
  if (suche) {
    query += ' AND (geschaeft LIKE ? OR notiz LIKE ?)';
    params.push(`%${suche}%`, `%${suche}%`);
  }

  query += ' ORDER BY datum DESC, erstellt_am DESC';
  const rows = db.prepare(query).all(...params);
  res.json(rows);
});

// GET single receipt
app.get('/api/belege/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM belege WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Beleg nicht gefunden' });
  res.json(row);
});

// POST create receipt
app.post('/api/belege', upload.single('datei'), (req, res) => {
  const { datum, geschaeft, betrag, kategorie, notiz } = req.body;

  if (!datum || !geschaeft || betrag === undefined || !kategorie) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(400).json({ error: 'Pflichtfelder fehlen: datum, geschaeft, betrag, kategorie' });
  }

  const stmt = db.prepare(`
    INSERT INTO belege (datum, geschaeft, betrag, kategorie, notiz, dateiname, dateipfad)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const result = stmt.run(
    datum,
    geschaeft,
    parseFloat(betrag),
    kategorie,
    notiz || null,
    req.file ? req.file.originalname : null,
    req.file ? req.file.filename : null
  );

  const created = db.prepare('SELECT * FROM belege WHERE id = ?').get(result.lastInsertRowid);
  res.status(201).json(created);
});

// PUT update receipt
app.put('/api/belege/:id', upload.single('datei'), (req, res) => {
  const existing = db.prepare('SELECT * FROM belege WHERE id = ?').get(req.params.id);
  if (!existing) {
    if (req.file) fs.unlinkSync(req.file.path);
    return res.status(404).json({ error: 'Beleg nicht gefunden' });
  }

  const { datum, geschaeft, betrag, kategorie, notiz } = req.body;

  let dateipfad = existing.dateipfad;
  let dateiname = existing.dateiname;

  if (req.file) {
    if (existing.dateipfad) {
      const oldPath = path.join(uploadsDir, existing.dateipfad);
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
    }
    dateipfad = req.file.filename;
    dateiname = req.file.originalname;
  }

  db.prepare(`
    UPDATE belege SET datum=?, geschaeft=?, betrag=?, kategorie=?, notiz=?, dateiname=?, dateipfad=?
    WHERE id=?
  `).run(
    datum || existing.datum,
    geschaeft || existing.geschaeft,
    betrag !== undefined ? parseFloat(betrag) : existing.betrag,
    kategorie || existing.kategorie,
    notiz !== undefined ? notiz : existing.notiz,
    dateiname,
    dateipfad,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM belege WHERE id = ?').get(req.params.id);
  res.json(updated);
});

// DELETE receipt
app.delete('/api/belege/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM belege WHERE id = ?').get(req.params.id);
  if (!row) return res.status(404).json({ error: 'Beleg nicht gefunden' });

  if (row.dateipfad) {
    const filePath = path.join(uploadsDir, row.dateipfad);
    if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
  }

  db.prepare('DELETE FROM belege WHERE id = ?').run(req.params.id);
  res.json({ success: true });
});

// GET statistics
app.get('/api/statistiken', (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as anzahl, SUM(betrag) as gesamt FROM belege').get();
  const byCategory = db.prepare(`
    SELECT kategorie, COUNT(*) as anzahl, SUM(betrag) as gesamt
    FROM belege GROUP BY kategorie ORDER BY gesamt DESC
  `).all();
  const thisMonth = db.prepare(`
    SELECT COUNT(*) as anzahl, SUM(betrag) as gesamt FROM belege
    WHERE strftime('%Y-%m', datum) = strftime('%Y-%m', 'now')
  `).get();

  res.json({ gesamt: total, dieserMonat: thisMonth, nachKategorie: byCategory });
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Belegverwaltung laeuft auf http://localhost:${PORT}`);
});
