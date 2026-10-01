// Belegungsliste: pro Aufenthalt eine Zeile (Name, Personen, Von, Bis, Zimmer).
// Wird aus der Excel-Belegung eingelesen (im Browser ausgewertet) oder direkt in der App gepflegt.
// Vor jedem Ersetzen der ganzen Liste wird der bisherige Stand gesichert (letzte 10) und lässt sich zurückholen.
const { db } = require('../lib/db');
const { requireLogin, requireVerwaltung, hatRolle } = require('../lib/auth');
const { protokolliere } = require('../lib/protokoll');

const MAX_EINTRAEGE = 2000;
const BEHALTE_STAENDE = 10;
const ISO = /^\d{4}-\d{2}-\d{2}$/;

function pruefeDatum(s) {
  if (!ISO.test(s || '')) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !isNaN(d) && d.toISOString().slice(0, 10) === s;
}

// Prüft und bereinigt einen Eintrag; gibt { wert } oder { fehler }
function bereinige(e) {
  if (!e || typeof e !== 'object') return { fehler: 'Ungültiger Eintrag' };
  const name = String(e.name == null ? '' : e.name).trim().slice(0, 120);
  if (!name) return { fehler: 'Bitte einen Namen angeben' };
  if (!pruefeDatum(e.von) || !pruefeDatum(e.bis)) return { fehler: 'Bitte gültige Daten für „von“ und „bis“ angeben' };
  if (e.bis < e.von) return { fehler: '„Bis“ darf nicht vor „Von“ liegen' };
  let personen = null;
  if (e.personen !== null && e.personen !== undefined && e.personen !== '') {
    personen = parseInt(e.personen, 10);
    if (isNaN(personen) || personen < 0 || personen > 999) return { fehler: 'Die Personenzahl muss eine Zahl zwischen 0 und 999 sein' };
  }
  const zimmer = String(e.zimmer == null ? '' : e.zimmer).trim().slice(0, 200) || null;
  const notiz = String(e.notiz == null ? '' : e.notiz).trim().slice(0, 500) || null;
  return { wert: { name, personen, von: e.von, bis: e.bis, zimmer, notiz } };
}

function alleEintraege() {
  return db.prepare('SELECT id, name, personen, von, bis, zimmer, notiz, quelle, erstellt_am, erstellt_von FROM belegung_eintraege ORDER BY von, bis, name').all();
}

function sichereStand(benutzer, grund) {
  const liste = alleEintraege();
  if (!liste.length) return null;
  const r = db.prepare('INSERT INTO belegung_staende (von_benutzer, grund, anzahl, daten) VALUES (?, ?, ?, ?)').run(benutzer ? benutzer.benutzername : null, grund, liste.length, JSON.stringify(liste));
  const alt = db.prepare('SELECT id FROM belegung_staende ORDER BY id DESC LIMIT -1 OFFSET ?').all(BEHALTE_STAENDE);
  for (const a of alt) db.prepare('DELETE FROM belegung_staende WHERE id = ?').run(a.id);
  return r.lastInsertRowid;
}

module.exports = function (app) {
  const darfSchreiben = req => hatRolle(req.session.benutzer, 'admin', 'verwaltung');

  app.get('/api/belegung/liste', requireLogin, (req, res) => {
    const letzter = db.prepare('SELECT zeit, von_benutzer, grund, anzahl FROM belegung_staende ORDER BY id DESC LIMIT 1').get();
    const antwort = { eintraege: alleEintraege(), kannSchreiben: darfSchreiben(req) };
    if (antwort.kannSchreiben) antwort.staende = db.prepare('SELECT id, zeit, von_benutzer, grund, anzahl FROM belegung_staende ORDER BY id DESC').all();
    res.json(antwort);
  });

  app.post('/api/belegung/liste', requireVerwaltung, (req, res) => {
    const r = bereinige(req.body);
    if (r.fehler) return res.status(400).json({ error: r.fehler });
    const e = r.wert;
    const info = db.prepare('INSERT INTO belegung_eintraege (name, personen, von, bis, zimmer, notiz, quelle, erstellt_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(e.name, e.personen, e.von, e.bis, e.zimmer, e.notiz, 'manuell', req.session.benutzer.benutzername);
    protokolliere(req.session.benutzer, 'belegung_eintrag_neu', 'belegung', info.lastInsertRowid, `${e.name} (${e.personen ?? '?'}) ${e.von}–${e.bis} ${e.zimmer || ''}`);
    res.status(201).json({ id: info.lastInsertRowid, ...e });
  });

  app.put('/api/belegung/liste/:id', requireVerwaltung, (req, res) => {
    const alt = db.prepare('SELECT * FROM belegung_eintraege WHERE id = ?').get(req.params.id);
    if (!alt) return res.status(404).json({ error: 'Eintrag nicht gefunden' });
    const r = bereinige(req.body);
    if (r.fehler) return res.status(400).json({ error: r.fehler });
    const e = r.wert;
    db.prepare('UPDATE belegung_eintraege SET name=?, personen=?, von=?, bis=?, zimmer=?, notiz=? WHERE id=?').run(e.name, e.personen, e.von, e.bis, e.zimmer, e.notiz, alt.id);
    protokolliere(req.session.benutzer, 'belegung_eintrag_geaendert', 'belegung', alt.id,
      `vorher: ${alt.name} (${alt.personen ?? '?'}) ${alt.von}–${alt.bis} ${alt.zimmer || ''} | nachher: ${e.name} (${e.personen ?? '?'}) ${e.von}–${e.bis} ${e.zimmer || ''}`);
    res.json({ id: alt.id, ...e });
  });

  app.delete('/api/belegung/liste/:id', requireVerwaltung, (req, res) => {
    const alt = db.prepare('SELECT * FROM belegung_eintraege WHERE id = ?').get(req.params.id);
    if (!alt) return res.status(404).json({ error: 'Eintrag nicht gefunden' });
    db.prepare('DELETE FROM belegung_eintraege WHERE id = ?').run(alt.id);
    protokolliere(req.session.benutzer, 'belegung_eintrag_geloescht', 'belegung', alt.id, `${alt.name} (${alt.personen ?? '?'}) ${alt.von}–${alt.bis} ${alt.zimmer || ''}`);
    res.json({ success: true });
  });

  // Alle Einträge eines Jahres auf einmal löschen (alles, was in der Jahresansicht erscheint, auch Aufenthalte über den Jahreswechsel).
  // Der bisherige Stand wird vorher gesichert und lässt sich unter "Frühere Stände" zurückholen.
  app.delete('/api/belegung/liste/jahr/:jahr', requireVerwaltung, (req, res) => {
    if (!/^\d{4}$/.test(req.params.jahr)) return res.status(400).json({ error: 'Ungültiges Jahr' });
    const jahr = req.params.jahr;
    const betroffen = db.prepare('SELECT COUNT(*) AS n FROM belegung_eintraege WHERE substr(von, 1, 4) <= ? AND substr(bis, 1, 4) >= ?').get(jahr, jahr).n;
    if (!betroffen) return res.json({ success: true, anzahl: 0 });
    db.transaction(() => {
      sichereStand(req.session.benutzer, `vor dem Leeren von ${jahr}`);
      db.prepare('DELETE FROM belegung_eintraege WHERE substr(von, 1, 4) <= ? AND substr(bis, 1, 4) >= ?').run(jahr, jahr);
    })();
    protokolliere(req.session.benutzer, 'belegung_jahr_geleert', 'belegung', null, `Jahr ${jahr}: ${betroffen} Einträge gelöscht (Stand gesichert)`);
    res.json({ success: true, anzahl: betroffen });
  });

  // Ganze Liste ersetzen (Import aus Excel). Der bisherige Stand wird vorher gesichert.
  app.post('/api/belegung/liste/import', requireVerwaltung, (req, res) => {
    const eingabe = (req.body && req.body.eintraege) || [];
    if (!Array.isArray(eingabe) || eingabe.length === 0) return res.status(400).json({ error: 'Keine Einträge zum Einlesen gefunden' });
    if (eingabe.length > MAX_EINTRAEGE) return res.status(400).json({ error: `Zu viele Einträge (maximal ${MAX_EINTRAEGE})` });
    const saubere = [];
    for (let i = 0; i < eingabe.length; i++) {
      const r = bereinige(eingabe[i]);
      if (r.fehler) return res.status(400).json({ error: `Eintrag ${i + 1}: ${r.fehler}` });
      saubere.push(r.wert);
    }
    const ersetzen = db.transaction(() => {
      sichereStand(req.session.benutzer, `Import${req.body.datei ? ' aus ' + String(req.body.datei).slice(0, 80) : ''}`);
      db.prepare('DELETE FROM belegung_eintraege').run();
      const ins = db.prepare('INSERT INTO belegung_eintraege (name, personen, von, bis, zimmer, notiz, quelle, erstellt_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const e of saubere) ins.run(e.name, e.personen, e.von, e.bis, e.zimmer, e.notiz, 'excel', req.session.benutzer.benutzername);
    });
    ersetzen();
    protokolliere(req.session.benutzer, 'belegung_import', 'belegung', null, `${saubere.length} Einträge${req.body.datei ? ' aus ' + String(req.body.datei).slice(0, 80) : ''}`);
    res.json({ success: true, anzahl: saubere.length });
  });

  // Einen früheren Stand zurückholen (der aktuelle wird vorher selbst gesichert -> "Rückgängig" ist umkehrbar)
  app.post('/api/belegung/liste/staende/:id/wiederherstellen', requireVerwaltung, (req, res) => {
    const stand = db.prepare('SELECT * FROM belegung_staende WHERE id = ?').get(req.params.id);
    if (!stand) return res.status(404).json({ error: 'Stand nicht gefunden' });
    let daten = [];
    try { daten = JSON.parse(stand.daten); } catch (e) { return res.status(500).json({ error: 'Stand beschädigt' }); }
    const zurueck = db.transaction(() => {
      sichereStand(req.session.benutzer, `vor Wiederherstellung von ${stand.zeit}`);
      db.prepare('DELETE FROM belegung_eintraege').run();
      const ins = db.prepare('INSERT INTO belegung_eintraege (name, personen, von, bis, zimmer, notiz, quelle, erstellt_von) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
      for (const e of daten) ins.run(e.name, e.personen, e.von, e.bis, e.zimmer, e.notiz, e.quelle || 'excel', e.erstellt_von || null);
    });
    zurueck();
    protokolliere(req.session.benutzer, 'belegung_wiederhergestellt', 'belegung', stand.id, `Stand vom ${stand.zeit} (${daten.length} Einträge)`);
    res.json({ success: true, anzahl: daten.length });
  });
};
