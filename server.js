// Belegverwaltung Ferienhaus Gibeli – Startdatei (Aufbau: lib/ = Grundlagen, routes/ = Funktionen)
const express = require('express');
const session = require('express-session');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const { PORT, dirs, secret } = require('./lib/config');
const { db, sicherung } = require('./lib/db');
const { SQLiteStore } = require('./lib/session');
const { requireLogin } = require('./lib/auth');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

// ----- Sicherheits-Header -----
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Permissions-Policy', 'camera=(self), microphone=(), geolocation=()');
  if (req.secure) res.setHeader('Strict-Transport-Security', 'max-age=15552000');
  if (req.path.startsWith('/api/')) res.setHeader('Cache-Control', 'no-store');
  next();
});

app.use(session({
  store: new SQLiteStore(),
  secret,
  resave: false,
  saveUninitialized: false,
  cookie: { maxAge: 7 * 24 * 60 * 60 * 1000, httpOnly: true, sameSite: 'lax', secure: 'auto' }
}));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ----- Öffentliche Dateien (vor der Anmeldung nötig) -----
const pub = f => (req, res) => res.sendFile(path.join(dirs.publicDir, f));
app.get('/login.html', pub('login.html'));
app.get('/login.css', pub('login.css'));
app.get('/admin.html', pub('admin.html'));
app.get('/excel-ansicht.js', pub('excel-ansicht.js'));
app.get('/excel-ansicht.css', pub('excel-ansicht.css'));
app.get('/belegung-liste.js', pub('belegung-liste.js'));
app.get('/belegung-liste.css', pub('belegung-liste.css'));
app.get('/wetter.js', pub('wetter.js'));
app.get('/wetter.css', pub('wetter.css'));
app.get('/manifest.webmanifest', (req, res) => { res.type('application/manifest+json'); pub('manifest.webmanifest')(req, res); });
app.use('/fonts', express.static(path.join(dirs.publicDir, 'fonts'), { maxAge: '30d', immutable: true }));
app.use('/icons', express.static(path.join(dirs.publicDir, 'icons'), { maxAge: '7d' }));

// Service Worker: Versionskennung ändert sich mit jedem Deploy, damit Handys immer die neue Version holen
function buildId() {
  const h = crypto.createHash('sha1');
  const geh = d => fs.readdirSync(d, { withFileTypes: true }).forEach(e => {
    const p = path.join(d, e.name);
    if (e.isDirectory()) return geh(p);
    const st = fs.statSync(p); h.update(`${p}:${st.size}:${st.mtimeMs}`);
  });
  try { geh(dirs.publicDir); } catch (e) {}
  return h.digest('hex').slice(0, 10);
}
const BUILD = buildId();
app.get('/sw.js', (req, res) => {
  let src = '';
  try { src = fs.readFileSync(path.join(dirs.publicDir, 'sw.js'), 'utf8'); } catch (e) { return res.status(404).end(); }
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(src.replace('__BUILD__', BUILD));
});

// ----- Funktionen -----
require('./routes/auth')(app);
app.use(requireLogin, express.static(dirs.publicDir)); // geschützte Oberfläche (index.html, app.js, …)
require('./routes/benutzer')(app);
require('./routes/belege')(app);
require('./routes/belegungsliste')(app); // vor excel.js: /api/belegung/liste darf nicht von /api/belegung/... verdeckt werden
require('./routes/excel')(app);
require('./routes/admin')(app);
require('./routes/wetter')(app);

// Fehler immer als JSON (z.B. falscher Dateityp beim Upload)
app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400);
  const text = err.code === 'LIMIT_FILE_SIZE' ? 'Die Datei ist zu gross' : (err.message || 'Fehler');
  if (status >= 500) console.error(err);
  res.status(status).json({ error: text });
});

{
  const p = sicherung.pruefe();
  if (!p.datenbankOk) console.error('WARNUNG: Datenbank-Integritätsprüfung:', p.integritaet);
  if (p.fehlendeDateien.length) console.error(`WARNUNG: Für ${p.fehlendeDateien.length} Belege fehlt die Datei im Upload-Ordner (IDs: ${p.fehlendeDateien.slice(0, 20).join(', ')})`);
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Belegverwaltung läuft auf http://localhost:${PORT}`);
  console.log(`Daten: ${dirs.dataDir} | Uploads: ${dirs.uploadsDir}`);
});
