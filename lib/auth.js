// Rollen, Zugriffs-Middleware, Schutz vor Durchprobieren (Login-Sperre)
const { db } = require('./db');

function getRollen(user) {
  return (user.rolle || '').split(',').map(r => r.trim()).filter(Boolean);
}
function hatRolle(user, ...rollen) {
  const userRollen = getRollen(user);
  return rollen.some(r => userRollen.includes(r));
}
const istPrivilegiert = user => hatRolle(user, 'admin', 'verwaltung');

// Bei Zwangs-Passwortwechsel (Standardpasswort / Erststart) ist nur noch das Ändern des Passworts möglich
const ERLAUBT_BEI_PASSWORTWECHSEL = ['/api/ich', '/api/logout', '/api/admin/profil'];

function requireLogin(req, res, next) {
  if (req.session && req.session.benutzer) {
    if (req.session.benutzer.mussAendern && !ERLAUBT_BEI_PASSWORTWECHSEL.includes(req.path.replace(/\/$/, '')) && req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Bitte zuerst das Passwort ändern', passwortAendern: true });
    }
    return next();
  }
  if (req.path.startsWith('/api/')) return res.status(401).json({ error: 'Nicht angemeldet' });
  res.redirect('/login.html');
}
function requireAdmin(req, res, next) {
  requireLogin(req, res, () => {
    if (hatRolle(req.session.benutzer, 'admin')) return next();
    res.status(403).json({ error: 'Kein Admin-Zugriff' });
  });
}
function requireVerwaltung(req, res, next) {
  requireLogin(req, res, () => {
    if (hatRolle(req.session.benutzer, 'admin', 'verwaltung')) return next();
    res.status(403).json({ error: 'Kein Zugriff' });
  });
}
function requireGerichte(req, res, next) {
  requireLogin(req, res, () => {
    if (hatRolle(req.session.benutzer, 'admin', 'gerichte')) return next();
    res.status(403).json({ error: 'Kein Zugriff' });
  });
}

// ----- Login-Sperre -----
// 5 Fehlversuche pro (IP + Benutzername) -> 15 Min. gesperrt; 20 pro Benutzername und 30 pro IP als Obergrenze.
const FENSTER = 15 * 60 * 1000;
const LIMITS = { paar: 5, benutzer: 20, ip: 30 };
const versuche = new Map(); // key -> [zeitstempel der Fehlversuche]

function bereinigt(key) {
  const jetzt = Date.now();
  const l = (versuche.get(key) || []).filter(t => jetzt - t < FENSTER);
  if (l.length) versuche.set(key, l); else versuche.delete(key);
  return l;
}
function schluessel(req, name) {
  const n = String(name || '').toLowerCase().trim();
  return { paar: `p|${req.ip}|${n}`, benutzer: `u|${n}`, ip: `i|${req.ip}` };
}
// Gibt die Wartezeit in Minuten zurück, wenn gesperrt, sonst 0
function gesperrtFuer(req, name) {
  const k = schluessel(req, name);
  let wartenMs = 0;
  for (const art of ['paar', 'benutzer', 'ip']) {
    const l = bereinigt(k[art]);
    if (l.length >= LIMITS[art]) wartenMs = Math.max(wartenMs, FENSTER - (Date.now() - l[0]));
  }
  return wartenMs ? Math.ceil(wartenMs / 60000) : 0;
}
function fehlversuch(req, name) {
  const k = schluessel(req, name);
  for (const art of ['paar', 'benutzer', 'ip']) {
    const l = bereinigt(k[art]); l.push(Date.now()); versuche.set(k[art], l);
  }
}
function loginErfolg(req, name) { versuche.delete(schluessel(req, name).paar); }
setInterval(() => { for (const k of [...versuche.keys()]) bereinigt(k); }, 10 * 60 * 1000).unref();

module.exports = { getRollen, hatRolle, istPrivilegiert, requireLogin, requireAdmin, requireVerwaltung, requireGerichte, gesperrtFuer, fehlversuch, loginErfolg };
