// Benutzerverwaltung und Admin-Profil
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const { ALLE_ROLLEN } = require('../lib/config');
const { requireAdmin } = require('../lib/auth');
const { protokolliere } = require('../lib/protokoll');

const VERBOTENE_PASSWOERTER = ['2202', '1111', '1234', 'admin', 'passwort', 'password', '12345678'];

module.exports = function (app) {
  app.get('/api/admin/benutzer', requireAdmin, (req, res) => {
    const users = db.prepare('SELECT id, benutzername, rolle, geburtsdatum, (pin IS NOT NULL AND pin != \'\') AS hat_pin, erstellt_am FROM benutzer ORDER BY erstellt_am DESC').all();
    res.json(users);
  });

  app.post('/api/admin/benutzer', requireAdmin, (req, res) => {
    const { benutzername, pin, rollen } = req.body;
    if (!benutzername || !pin) return res.status(400).json({ error: 'Benutzername und PIN erforderlich' });
    if (!/^\d{4}$/.test(String(pin))) return res.status(400).json({ error: 'Der PIN muss genau 4 Ziffern haben' });
    if (db.prepare('SELECT id FROM benutzer WHERE benutzername = ?').get(benutzername))
      return res.status(400).json({ error: 'Benutzername bereits vergeben' });

    const rolleStr = Array.isArray(rollen) && rollen.length > 0
      ? rollen.filter(r => ALLE_ROLLEN.includes(r)).join(',')
      : 'gibeli-gast';
    const result = db.prepare("INSERT INTO benutzer (benutzername, passwort, rolle, pin) VALUES (?, '', ?, ?)")
      .run(benutzername, rolleStr || 'gibeli-gast', bcrypt.hashSync(String(pin), 10));
    protokolliere(req.session.benutzer, 'benutzer_angelegt', 'benutzer', result.lastInsertRowid, `${benutzername} (${rolleStr})`);
    res.status(201).json({ id: result.lastInsertRowid, benutzername, rolle: rolleStr });
  });

  app.put('/api/admin/benutzer/:id/pin', requireAdmin, (req, res) => {
    const user = db.prepare('SELECT id, benutzername FROM benutzer WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    if (!/^\d{4}$/.test(String((req.body || {}).pin || ''))) return res.status(400).json({ error: 'Der PIN muss genau 4 Ziffern haben' });
    db.prepare('UPDATE benutzer SET pin = ? WHERE id = ?').run(bcrypt.hashSync(String(req.body.pin), 10), req.params.id);
    protokolliere(req.session.benutzer, 'pin_gesetzt', 'benutzer', user.id, user.benutzername);
    res.json({ success: true });
  });

  app.put('/api/admin/benutzer/:id/rollen', requireAdmin, (req, res) => {
    const user = db.prepare('SELECT * FROM benutzer WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    if (user.id === req.session.benutzer.id) return res.status(400).json({ error: 'Eigene Rollen nicht änderbar' });
    const { rollen } = req.body;
    if (!Array.isArray(rollen) || rollen.length === 0) return res.status(400).json({ error: 'Mindestens eine Rolle erforderlich' });
    const filtered = rollen.filter(r => ALLE_ROLLEN.includes(r));
    if (filtered.length === 0) return res.status(400).json({ error: 'Ungültige Rollen' });
    db.prepare('UPDATE benutzer SET rolle = ? WHERE id = ?').run(filtered.join(','), req.params.id);
    protokolliere(req.session.benutzer, 'rollen_geaendert', 'benutzer', user.id, `${user.benutzername}: ${user.rolle} → ${filtered.join(',')}`);
    res.json({ success: true, rolle: filtered.join(',') });
  });

  // Benutzer löschen: seine Belege landen im Papierkorb (30 Tage wiederherstellbar) statt endgültig zu verschwinden
  app.delete('/api/admin/benutzer/:id', requireAdmin, (req, res) => {
    const user = db.prepare('SELECT * FROM benutzer WHERE id = ?').get(req.params.id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    if (user.id === req.session.benutzer.id) return res.status(400).json({ error: 'Eigenen Account nicht löschbar' });
    const n = db.prepare(`UPDATE belege SET geloescht_am = datetime('now'), geloescht_von = ? WHERE benutzer_id = ? AND geloescht_am IS NULL`)
      .run(`${req.session.benutzer.benutzername} (Benutzer gelöscht)`, req.params.id).changes;
    db.prepare('DELETE FROM benutzer WHERE id = ?').run(req.params.id);
    protokolliere(req.session.benutzer, 'benutzer_geloescht', 'benutzer', user.id, `${user.benutzername}; ${n} Beleg(e) in den Papierkorb`);
    res.json({ success: true, belegeImPapierkorb: n });
  });

  // Eigenes Admin-Profil (Name/Passwort). Beim Zwangswechsel (Standardpasswort) ist ein neues Passwort Pflicht.
  app.put('/api/admin/profil', requireAdmin, (req, res) => {
    const { benutzername, passwortAktuell, passwortNeu } = req.body;
    const userId = req.session.benutzer.id;
    const dbUser = db.prepare('SELECT * FROM benutzer WHERE id = ?').get(userId);
    if (!dbUser) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    if (!passwortAktuell || !bcrypt.compareSync(String(passwortAktuell), dbUser.passwort))
      return res.status(401).json({ error: 'Aktuelles Passwort ist falsch' });
    const updates = [], params = [];
    if (benutzername && benutzername.trim() && benutzername.trim() !== dbUser.benutzername) {
      if (db.prepare('SELECT id FROM benutzer WHERE benutzername = ? AND id != ?').get(benutzername.trim(), userId))
        return res.status(400).json({ error: 'Benutzername bereits vergeben' });
      updates.push('benutzername = ?'); params.push(benutzername.trim());
    }
    if (passwortNeu) {
      if (String(passwortNeu).length < 8) return res.status(400).json({ error: 'Das neue Passwort muss mindestens 8 Zeichen haben' });
      if (VERBOTENE_PASSWOERTER.includes(String(passwortNeu).toLowerCase())) return res.status(400).json({ error: 'Dieses Passwort ist zu einfach – bitte ein anderes wählen' });
      if (bcrypt.compareSync(String(passwortNeu), dbUser.passwort)) return res.status(400).json({ error: 'Das neue Passwort muss sich vom aktuellen unterscheiden' });
      updates.push('passwort = ?'); params.push(bcrypt.hashSync(String(passwortNeu), 10));
      updates.push('muss_passwort_aendern = 0');
    } else if (dbUser.muss_passwort_aendern) {
      return res.status(400).json({ error: 'Bitte ein neues Passwort setzen (mindestens 8 Zeichen)' });
    }
    if (updates.length === 0) return res.status(400).json({ error: 'Bitte neuen Namen oder neues Passwort angeben' });
    params.push(userId);
    db.prepare(`UPDATE benutzer SET ${updates.join(', ')} WHERE id = ?`).run(...params);
    if (benutzername && benutzername.trim() !== dbUser.benutzername) req.session.benutzer.benutzername = benutzername.trim();
    if (passwortNeu) req.session.benutzer.mussAendern = false;
    protokolliere(req.session.benutzer, 'admin_profil_geaendert', 'benutzer', userId, [benutzername ? 'Name' : null, passwortNeu ? 'Passwort' : null].filter(Boolean).join(', '));
    res.json({ success: true });
  });
};
