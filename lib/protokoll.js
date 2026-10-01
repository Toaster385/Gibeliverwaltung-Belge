// Änderungsprotokoll: wer hat wann was getan (nur für Admins einsehbar)
const { db } = require('./db');

const einfuegen = db.prepare(`INSERT INTO protokoll (benutzer_id, benutzername, aktion, ziel_typ, ziel_id, details) VALUES (?, ?, ?, ?, ?, ?)`);

// akteur: req.session.benutzer ODER null (System)
function protokolliere(akteur, aktion, zielTyp, zielId, details) {
  try {
    einfuegen.run(
      akteur ? akteur.id : null,
      akteur ? akteur.benutzername : 'System',
      aktion, zielTyp || null, zielId || null,
      details == null ? null : String(typeof details === 'string' ? details : JSON.stringify(details)).slice(0, 2000)
    );
  } catch (e) { console.error('Protokoll-Fehler:', e.message); }
}

// Beschreibt Änderungen zwischen zwei Datensätzen: "betrag: 10 → 12; datum: …"
function diff(alt, neu, felder) {
  const out = [];
  for (const f of felder) {
    if (alt[f] !== neu[f] && !(alt[f] == null && neu[f] == null)) out.push(`${f}: ${alt[f] ?? '–'} → ${neu[f] ?? '–'}`);
  }
  return out.join('; ');
}

module.exports = { protokolliere, diff };
