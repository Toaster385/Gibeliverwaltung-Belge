// Anmeldung, eigene Daten, öffentliche Einstellungen, Healthcheck
const bcrypt = require('bcryptjs');
const { db } = require('../lib/db');
const { getRollen, requireLogin, gesperrtFuer, fehlversuch, loginErfolg } = require('../lib/auth');
const { protokolliere } = require('../lib/protokoll');

module.exports = function (app) {
  // Für Railway: antwortet nur, wenn die Datenbank erreichbar ist
  app.get('/healthz', (req, res) => {
    try { db.prepare('SELECT 1').get(); res.json({ status: 'ok' }); }
    catch (e) { res.status(500).json({ status: 'fehler' }); }
  });

  app.post('/api/login', (req, res) => {
    const { benutzername, passwort, pin } = req.body || {};
    if (!benutzername) return res.status(400).json({ error: 'Benutzername erforderlich' });

    const warten = gesperrtFuer(req, benutzername);
    if (warten) {
      protokolliere(null, 'login_gesperrt', 'benutzer', null, `${benutzername} (IP ${req.ip})`);
      return res.status(429).json({ error: `Zu viele Fehlversuche. Bitte in ${warten} Minute${warten === 1 ? '' : 'n'} erneut versuchen.` });
    }

    const user = db.prepare('SELECT * FROM benutzer WHERE benutzername = ?').get(benutzername);
    if (!user) { fehlversuch(req, benutzername); return res.status(401).json({ error: 'Falscher Benutzername oder Zugangsdaten' }); }

    const rollen = getRollen(user);
    if (rollen.includes('admin')) {
      if (!passwort || !bcrypt.compareSync(String(passwort), user.passwort)) {
        fehlversuch(req, benutzername);
        return res.status(401).json({ error: 'Falsches Passwort' });
      }
    } else {
      if (!user.pin) return res.status(401).json({ error: 'Für dieses Konto ist noch kein PIN gesetzt – bitte beim Admin melden' });
      if (!/^\d{4}$/.test(String(pin || '')) || !bcrypt.compareSync(String(pin), user.pin)) {
        fehlversuch(req, benutzername);
        return res.status(401).json({ error: 'Falscher PIN' });
      }
    }

    loginErfolg(req, benutzername);
    const sitzung = { id: user.id, benutzername: user.benutzername, rolle: user.rolle, mussAendern: !!user.muss_passwort_aendern };
    // Neue Sitzungs-ID nach dem Login (Schutz vor Session-Fixation)
    req.session.regenerate(err => {
      if (err) return res.status(500).json({ error: 'Anmeldung fehlgeschlagen' });
      req.session.benutzer = sitzung;
      req.session.save(() => {
        if (rollen.includes('admin')) protokolliere(sitzung, 'login', 'benutzer', user.id, null);
        res.json({ rolle: user.rolle, benutzername: user.benutzername, passwortAendern: sitzung.mussAendern });
      });
    });
  });

  app.post('/api/logout', (req, res) => {
    req.session.destroy(() => res.json({ success: true }));
  });

  app.get('/api/ich', requireLogin, (req, res) => {
    const u = db.prepare('SELECT pin IS NOT NULL AND pin != \'\' AS hat_pin FROM benutzer WHERE id = ?').get(req.session.benutzer.id);
    res.json({ ...req.session.benutzer, hatPin: !!(u && u.hat_pin) });
  });

  // Gäste ändern ihren PIN selbst
  app.put('/api/ich/pin', requireLogin, (req, res) => {
    const { pinAlt, pinNeu } = req.body || {};
    const user = db.prepare('SELECT * FROM benutzer WHERE id = ?').get(req.session.benutzer.id);
    if (!user) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    const warten = gesperrtFuer(req, user.benutzername);
    if (warten) return res.status(429).json({ error: `Zu viele Fehlversuche. Bitte in ${warten} Minute(n) erneut versuchen.` });
    if (!/^\d{4}$/.test(String(pinNeu || ''))) return res.status(400).json({ error: 'Der neue PIN muss genau 4 Ziffern haben' });
    if (user.pin && (!/^\d{4}$/.test(String(pinAlt || '')) || !bcrypt.compareSync(String(pinAlt), user.pin))) {
      fehlversuch(req, user.benutzername);
      return res.status(401).json({ error: 'Der aktuelle PIN ist falsch' });
    }
    db.prepare('UPDATE benutzer SET pin = ? WHERE id = ?').run(bcrypt.hashSync(String(pinNeu), 10), user.id);
    protokolliere(req.session.benutzer, 'pin_selbst_geaendert', 'benutzer', user.id, null);
    res.json({ success: true });
  });

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
        const r2 = https.get('https://api.frankfurter.app/latest?from=EUR&to=CHF', r => {
          let body = '';
          r.on('data', d => body += d);
          r.on('end', () => { try { resolve(JSON.parse(body)); } catch (e) { reject(e); } });
          r.on('error', reject);
        });
        r2.on('error', reject);
        r2.setTimeout(5000, () => r2.destroy(new Error('Timeout')));
      });
      if (!data || !data.rates || !data.rates.CHF) throw new Error('Ungültige Antwort');
      res.json({ EUR_to_CHF: data.rates.CHF, CHF_to_EUR: +(1 / data.rates.CHF).toFixed(6) });
    } catch (e) {
      res.json({ EUR_to_CHF: 0.95, CHF_to_EUR: 1.053, fallback: true });
    }
  });
};
