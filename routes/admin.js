// Admin: Belegübersicht, Kasse, Perioden, Datensicherheit, Protokoll
const { db, sicherung } = require('../lib/db');
const { requireAdmin, requireVerwaltung } = require('../lib/auth');
const { protokolliere } = require('../lib/protokoll');
const mail = require('../lib/mail');

module.exports = function (app) {
  // ----- Belege -----
  app.get('/api/admin/belege', requireVerwaltung, (req, res) => {
    res.json(db.prepare(`
      SELECT b.*, u.benutzername FROM belege b
      LEFT JOIN benutzer u ON b.benutzer_id = u.id
      WHERE b.geloescht_am IS NULL
      ORDER BY b.datum DESC
    `).all().map(r => ({ ...r, benutzername: r.benutzername || '(gelöscht)' })));
  });

  app.put('/api/admin/belege/:id/status', requireVerwaltung, (req, res) => {
    const { status } = req.body;
    if (status !== 'ausstehend' && status !== 'eingetragen') return res.status(400).json({ error: 'Ungültiger Status' });
    const row = db.prepare('SELECT id, status FROM belege WHERE id = ? AND geloescht_am IS NULL').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'Beleg nicht gefunden' });
    db.prepare('UPDATE belege SET status = ? WHERE id = ?').run(status, req.params.id);
    protokolliere(req.session.benutzer, 'status_geaendert', 'beleg', row.id, `${row.status} → ${status}`);
    res.json({ success: true, status });
  });

  app.get('/api/admin/statistiken', requireVerwaltung, (req, res) => {
    const gesamt = db.prepare(`
      SELECT COUNT(*) as anzahl,
             SUM(CASE WHEN waehrung='EUR' THEN betrag ELSE 0 END) as summe_eur,
             SUM(CASE WHEN waehrung='CHF' THEN betrag ELSE 0 END) as summe_chf
      FROM belege WHERE geloescht_am IS NULL
    `).get();
    const nachBenutzer = db.prepare(`
      SELECT u.benutzername, COUNT(b.id) as anzahl, SUM(b.betrag) as summe
      FROM benutzer u LEFT JOIN belege b ON b.benutzer_id = u.id AND b.geloescht_am IS NULL
      GROUP BY u.id ORDER BY summe DESC
    `).all();
    res.json({ gesamt, nachBenutzer });
  });

  // ----- Datensicherheit -----
  setInterval(() => sicherung.taeglich(), 3 * 3600 * 1000).unref();
  sicherung.taeglich();
  mail.starteWoechentlich();

  app.get('/api/admin/integritaet', requireAdmin, (req, res) => {
    res.json({ ...sicherung.pruefe(), email: mail.status(),
      papierkorb: db.prepare('SELECT COUNT(*) n FROM belege WHERE geloescht_am IS NOT NULL').get().n });
  });

  app.post('/api/admin/backup/jetzt', requireAdmin, (req, res) => {
    try {
      sicherung.snapshot('manuell');
      protokolliere(req.session.benutzer, 'backup_manuell', 'backup', null, null);
      res.json({ ...sicherung.pruefe(), email: mail.status() });
    } catch (e) { res.status(500).json({ error: 'Sicherung fehlgeschlagen: ' + e.message }); }
  });

  app.post('/api/admin/backup/email', requireAdmin, async (req, res) => {
    try { res.json({ success: true, ...(await mail.sendeBackup(req.session.benutzer, 'manuell ausgelöst')) }); }
    catch (e) { res.status(400).json({ error: e.message }); }
  });

  app.get('/api/admin/backup/download', requireAdmin, (req, res) => {
    const name = `gibeli-backup-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.zip`;
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    protokolliere(req.session.benutzer, 'backup_download', 'backup', null, null);
    try { sicherung.zipSchreiben(res); }
    catch (e) { if (!res.headersSent) res.status(500).json({ error: 'Export fehlgeschlagen' }); else res.destroy(e); }
  });

  // ----- Protokoll -----
  app.get('/api/admin/protokoll', requireAdmin, (req, res) => {
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const offset = Math.max(parseInt(req.query.offset) || 0, 0);
    const aktion = req.query.aktion;
    const where = aktion ? 'WHERE aktion = ?' : '';
    const args = aktion ? [aktion] : [];
    const rows = db.prepare(`SELECT * FROM protokoll ${where} ORDER BY id DESC LIMIT ? OFFSET ?`).all(...args, limit, offset);
    const total = db.prepare(`SELECT COUNT(*) n FROM protokoll ${where}`).get(...args).n;
    res.json({ eintraege: rows, total });
  });

  // ----- Kasse -----
  app.post('/api/admin/kasse', requireAdmin, (req, res) => {
    const { geschlossen } = req.body;
    db.prepare(`UPDATE einstellungen SET wert = ? WHERE schluessel = 'kasse_geschlossen'`).run(geschlossen ? '1' : '0');
    protokolliere(req.session.benutzer, geschlossen ? 'kasse_geschlossen' : 'kasse_geoeffnet', 'kasse', null, null);
    res.json({ success: true, kasse_geschlossen: !!geschlossen });
  });

  // ----- Perioden -----
  app.get('/api/admin/perioden', requireAdmin, (req, res) => {
    const perioden = db.prepare('SELECT * FROM perioden ORDER BY von DESC').all();
    const aktive = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='aktive_periode'`).get();
    const aktiveId = parseInt(aktive?.wert || '0');
    const periodenMitStats = perioden.map(p => {
      const stats = db.prepare(`
        SELECT COUNT(*) as anzahl,
               SUM(CASE WHEN waehrung='EUR' THEN betrag ELSE 0 END) as summe_eur,
               SUM(CASE WHEN waehrung='CHF' THEN betrag ELSE 0 END) as summe_chf
        FROM belege WHERE geloescht_am IS NULL AND datum >= ? AND datum <= ?
      `).get(p.von, p.bis);
      return Object.assign({}, p, { stats });
    });
    res.json({ perioden: periodenMitStats, aktive_periode_id: aktiveId });
  });

  app.post('/api/admin/perioden', requireAdmin, (req, res) => {
    const { name, von, bis } = req.body;
    if (!name || !von || !bis) return res.status(400).json({ error: 'Name, Von und Bis sind erforderlich' });
    if (von > bis) return res.status(400).json({ error: 'Startdatum muss vor Enddatum liegen' });
    const result = db.prepare('INSERT INTO perioden (name, von, bis) VALUES (?, ?, ?)').run(name, von, bis);
    protokolliere(req.session.benutzer, 'periode_angelegt', 'periode', result.lastInsertRowid, `${name} ${von} – ${bis}`);
    res.status(201).json(db.prepare('SELECT * FROM perioden WHERE id = ?').get(result.lastInsertRowid));
  });

  app.put('/api/admin/perioden/:id/aktivieren', requireAdmin, (req, res) => {
    const periode = db.prepare('SELECT * FROM perioden WHERE id = ?').get(req.params.id);
    if (!periode) return res.status(404).json({ error: 'Periode nicht gefunden' });
    db.prepare(`UPDATE einstellungen SET wert = ? WHERE schluessel = 'aktive_periode'`).run(String(req.params.id));
    db.prepare(`UPDATE einstellungen SET wert = '0' WHERE schluessel = 'kasse_geschlossen'`).run();
    protokolliere(req.session.benutzer, 'periode_aktiviert', 'periode', periode.id, periode.name);
    res.json({ success: true, aktive_periode: periode });
  });

  app.delete('/api/admin/perioden/aktiv', requireAdmin, (req, res) => {
    db.prepare(`UPDATE einstellungen SET wert = '0' WHERE schluessel = 'aktive_periode'`).run();
    db.prepare(`UPDATE einstellungen SET wert = '1' WHERE schluessel = 'kasse_geschlossen'`).run();
    protokolliere(req.session.benutzer, 'periode_beendet', 'periode', null, 'Kasse geschlossen');
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
    protokolliere(req.session.benutzer, 'periode_geloescht', 'periode', periode.id, periode.name);
    res.json({ success: true });
  });
};
