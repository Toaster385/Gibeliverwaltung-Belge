// Backup per E-Mail (optional): wöchentlich automatisch, wenn SMTP und BACKUP_EMAIL_TO gesetzt sind.
// Sicherung ausserhalb von Railway – schützt auch, wenn das Volume selbst verloren geht.
const fs = require('fs');
const { db, sicherung } = require('./db');
const { protokolliere } = require('./protokoll');

const MAX_BYTES = 18 * 1024 * 1024; // gängige Grenze für E-Mail-Anhänge

function konfiguriert() {
  return !!(process.env.SMTP_HOST && process.env.BACKUP_EMAIL_TO);
}

function transporter() {
  const nodemailer = require('nodemailer');
  if (process.env.SMTP_HOST === 'json') return nodemailer.createTransport({ jsonTransport: true }); // nur für Tests
  const port = parseInt(process.env.SMTP_PORT || '587');
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST, port,
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465,
    auth: process.env.SMTP_USER ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } : undefined
  });
}

async function sendeBackup(akteur, grund) {
  if (!konfiguriert()) throw new Error('E-Mail-Backup nicht eingerichtet (SMTP_HOST und BACKUP_EMAIL_TO fehlen)');
  const pruef = sicherung.pruefe();
  let anhang, art;
  const zip = await sicherung.zipDatei();
  if (zip.bytes <= MAX_BYTES) { anhang = zip; art = 'Datenbank + alle Belegfotos (ZIP)'; }
  else { try { fs.unlinkSync(zip.pfad); } catch (e) {} anhang = sicherung.dbGzDatei(); art = 'nur Datenbank (die Fotos sind für eine E-Mail zu gross – bitte im Admin-Bereich das ZIP herunterladen)'; }
  try {
    const t = transporter();
    const datum = new Date().toISOString().slice(0, 10);
    const info = await t.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER || 'backup@gibeli.local',
      to: process.env.BACKUP_EMAIL_TO,
      subject: `Gibeli Belegverwaltung – Backup ${datum}`,
      text: `Automatische Sicherung der Belegverwaltung.\n\nInhalt: ${art}\nBelege: ${pruef.anzahlBelege}\nDatenbank in Ordnung: ${pruef.datenbankOk ? 'ja' : 'NEIN'}\nFehlende Fotos: ${pruef.fehlendeDateien.length}\nAnlass: ${grund}\n\nBitte an einem sicheren Ort aufbewahren.`,
      attachments: [{ filename: `gibeli-backup-${datum}${anhang.pfad.endsWith('.zip') ? '.zip' : '.db.gz'}`, path: anhang.pfad }]
    });
    db.prepare(`INSERT OR REPLACE INTO einstellungen (schluessel, wert) VALUES ('letzte_backup_mail', ?)`).run(new Date().toISOString());
    protokolliere(akteur, 'backup_email', 'backup', null, `${process.env.BACKUP_EMAIL_TO}: ${art}, ${Math.round(anhang.bytes / 1024)} KB`);
    return { gesendetAn: process.env.BACKUP_EMAIL_TO, art, kb: Math.round(anhang.bytes / 1024), info: info && info.messageId };
  } finally { try { fs.unlinkSync(anhang.pfad); } catch (e) {} }
}

function status() {
  const letzte = db.prepare(`SELECT wert FROM einstellungen WHERE schluessel='letzte_backup_mail'`).get();
  return { konfiguriert: konfiguriert(), an: konfiguriert() ? process.env.BACKUP_EMAIL_TO : null, letzte: letzte ? letzte.wert : null };
}

// Alle 6 Stunden prüfen, ob die wöchentliche Sicherung fällig ist
function starteWoechentlich() {
  if (!konfiguriert()) return;
  const pruefen = () => {
    const l = status().letzte;
    if (!l || Date.now() - new Date(l).getTime() > 7 * 86400000) {
      sendeBackup(null, 'wöchentlich automatisch').catch(e => console.error('E-Mail-Backup fehlgeschlagen:', e.message));
    }
  };
  setInterval(pruefen, 6 * 3600 * 1000).unref();
  setTimeout(pruefen, 60 * 1000).unref();
}

module.exports = { sendeBackup, status, starteWoechentlich, konfiguriert };
