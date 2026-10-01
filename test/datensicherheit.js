// Garantie-Test: Daten, die mit der ALTEN Version (Stand vor allen Änderungen) gespeichert wurden,
// müssen nach dem Start der AKTUELLEN Version vollständig und unverändert vorhanden sein.
//   npm run test:daten
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const Database = require('better-sqlite3');

const repo = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gibeli-test-'));
const dataDir = path.join(tmp, 'data'), uploadsDir = path.join(tmp, 'uploads');
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
let fehler = 0;
const kinder = [];
process.on('exit', () => kinder.forEach(k => { try { k.kill(); } catch (e) {} }));
const ok = (b, text) => { console.log((b ? '  ✓ ' : '  ✗ ') + text); if (!b) fehler++; };
const sha = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');

function starte(script, port) {
  const env = { ...process.env, PORT: String(port), DATA_DIR: dataDir, UPLOADS_DIR: uploadsDir, NODE_PATH: path.join(repo, 'node_modules') };
  const p = spawn('node', [script], { env, cwd: repo });
  kinder.push(p);
  let log = ''; p.stdout.on('data', d => log += d); p.stderr.on('data', d => log += d);
  return new Promise((res, rej) => {
    const t = setInterval(async () => {
      try { await fetch(`http://localhost:${port}/login.html`); clearInterval(t); res({ p, log: () => log }); } catch (e) {}
    }, 200);
    p.on('exit', c => { clearInterval(t); rej(new Error('Server beendet (' + c + '):\n' + log)); });
    setTimeout(() => { clearInterval(t); rej(new Error('Timeout beim Start:\n' + log)); }, 30000);
  });
}
async function api(port, cookie, method, url, body, form) {
  const opt = { method, headers: { cookie: cookie || '' } };
  if (form) opt.body = form; else if (body) { opt.body = JSON.stringify(body); opt.headers['content-type'] = 'application/json'; }
  const r = await fetch(`http://localhost:${port}${url}`, opt);
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch (e) {}
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0], json, buf };
}

(async () => {
  console.log('1) Alte Version (Original-Stand) speichert Daten …');
  const alt = await starte(path.join(__dirname, 'fixtures', 'legacy-server.js'), 3911);
  let c = (await api(3911, '', 'POST', '/api/login', { benutzername: 'Lio', passwort: '2202' })).cookie;
  await api(3911, c, 'POST', '/api/admin/benutzer', { benutzername: 'Anna', geburtsdatum: '1990-05-17', rollen: ['gibeli-gast'] });
  for (let i = 1; i <= 5; i++) {
    const f = new FormData();
    f.append('datum', `2026-09-0${i}`); f.append('geschaeft', 'Laden ' + i); f.append('betrag', String(10 * i + 0.5));
    f.append('belegnummer', String(100 + i)); f.append('waehrung', i % 2 ? 'CHF' : 'EUR'); f.append('notiz', 'Notiz ' + i);
    f.append('datei', new Blob([Buffer.concat([PNG, Buffer.from(String(i))])], { type: 'image/png' }), `beleg${i}.png`);
    const r = await api(3911, c, 'POST', '/api/belege', null, f);
    if (r.status !== 201) throw new Error('Alter Server: Beleg anlegen fehlgeschlagen ' + r.status);
  }
  const f = new FormData(); f.append('datei', new Blob(['xlsx'], { type: 'application/octet-stream' }), 'belegung.xlsx');
  await api(3911, c, 'POST', '/api/belegung', null, f);
  alt.p.kill(); await new Promise(r => setTimeout(r, 500));

  const dbVorher = new Database(path.join(dataDir, 'belege.db'), { readonly: true });
  const belegeVorher = dbVorher.prepare('SELECT * FROM belege ORDER BY id').all();
  const benutzerVorher = dbVorher.prepare('SELECT id, benutzername, rolle, geburtsdatum FROM benutzer ORDER BY id').all();
  dbVorher.close();
  const hashVorher = Object.fromEntries(belegeVorher.map(b => [b.dateipfad, sha(path.join(uploadsDir, b.dateipfad))]));
  console.log(`   gespeichert: ${belegeVorher.length} Belege, ${benutzerVorher.length} Benutzer, ${Object.keys(hashVorher).length} Dateien`);

  console.log('2) Aktuelle Version startet auf denselben Daten …');
  const neu = await starte(path.join(repo, 'server.js'), 3912);
  const dbNachher = new Database(path.join(dataDir, 'belege.db'), { readonly: true });
  const belegeNachher = dbNachher.prepare('SELECT * FROM belege ORDER BY id').all();
  const benutzerNachher = dbNachher.prepare('SELECT id, benutzername, rolle, geburtsdatum FROM benutzer ORDER BY id').all();
  dbNachher.close();

  ok(belegeNachher.length === belegeVorher.length, `Anzahl Belege unverändert (${belegeNachher.length})`);
  const gleich = belegeVorher.every((b, i) => Object.keys(b).every(k => b[k] === belegeNachher[i][k]));
  ok(gleich, 'Alle Felder aller Belege unverändert (Datum, Betrag, Währung, Nummer, Notiz, Status, Dateiname …)');
  ok(benutzerVorher.every(u => benutzerNachher.some(n => JSON.stringify(n) === JSON.stringify(u))), 'Alle Benutzer samt Rollen/Geburtsdatum vorhanden');
  ok(Object.entries(hashVorher).every(([n, h]) => fs.existsSync(path.join(uploadsDir, n)) && sha(path.join(uploadsDir, n)) === h), 'Alle Belegfotos vorhanden und Byte für Byte identisch');
  ok(fs.readdirSync(path.join(dataDir, 'belegung')).length === 1, 'Belegungs-Datei vorhanden');
  const backups = fs.existsSync(path.join(dataDir, 'backups')) ? fs.readdirSync(path.join(dataDir, 'backups')).filter(f => f.endsWith('-start.db')) : [];
  ok(backups.length >= 1, 'Sicherung vor dem Start wurde angelegt');
  if (backups.length) {
    const b = new Database(path.join(dataDir, 'backups', backups[0]), { readonly: true });
    ok(b.prepare('SELECT COUNT(*) n FROM belege').get().n === belegeVorher.length, 'Sicherung enthält alle Belege');
    ok(!b.prepare('PRAGMA table_info(belege)').all().some(col => col.name === 'verifiziert'), 'Sicherung ist der Stand VOR der Migration');
    b.close();
  }

  const login1 = await api(3912, '', 'POST', '/api/login', { benutzername: 'Lio', passwort: '2202' });
  c = login1.cookie;
  ok(login1.json && login1.json.passwortAendern === true, 'Admin mit altem Standardpasswort muss das Passwort ändern');
  const gesperrt = await api(3912, c, 'GET', '/api/admin/belege');
  ok(gesperrt.status === 403 && gesperrt.json.passwortAendern, 'Bis zum Passwortwechsel sind keine Daten abrufbar');
  const schwach = await api(3912, c, 'PUT', '/api/admin/profil', { passwortAktuell: '2202', passwortNeu: '1111' });
  ok(schwach.status === 400, 'Schwaches neues Passwort wird abgelehnt');
  const wechsel = await api(3912, c, 'PUT', '/api/admin/profil', { passwortAktuell: '2202', passwortNeu: 'Neues-Passwort-42' });
  ok(wechsel.status === 200, 'Passwortwechsel funktioniert');
  const liste = await api(3912, c, 'GET', '/api/admin/belege');
  ok(liste.status === 200 && liste.json.length === belegeVorher.length, 'Admin sieht alle Belege über die App');
  const datei = await api(3912, c, 'GET', '/uploads/' + belegeVorher[0].dateipfad);
  ok(datei.status === 200, 'Belegfoto wird von der App ausgeliefert');
  const integ = await api(3912, c, 'GET', '/api/admin/integritaet');
  ok(integ.json && integ.json.datenbankOk && integ.json.fehlendeDateien.length === 0, 'Integritätsprüfung: Datenbank ok, keine fehlenden Dateien');
  const zip = await api(3912, c, 'GET', '/api/admin/backup/download');
  const bel0 = (await api(3912, c, 'GET', '/api/admin/belege')).json;
  ok(bel0.every(b => b.verifiziert === 0 && b.auto_datum === 0), 'Alte Belege gelten als manuell erfasst (keine falschen Markierungen)');
  const zbuf = zip.buf;
  ok(zip.status === 200 && zbuf.slice(0, 2).toString() === 'PK' && zbuf.length > 500, `ZIP-Export funktioniert (${zbuf.length} Bytes)`);
  // ZIP-Inhalt prüfen (Einträge im Central Directory)
  const zipText = zbuf.toString('latin1');
  ok(zipText.includes('belege.db') && Object.keys(hashVorher).every(n => zipText.includes('uploads/' + n)) && zipText.includes('belegung/'), 'ZIP enthält Datenbank, alle Belegfotos und die Belegungs-Datei');
  neu.p.kill();

  console.log('3) Zweiter Neustart (nichts darf sich verändern) …');
  const neu2 = await starte(path.join(repo, 'server.js'), 3913);
  const d3 = new Database(path.join(dataDir, 'belege.db'), { readonly: true });
  ok(d3.prepare('SELECT COUNT(*) n FROM belege').get().n === belegeVorher.length, 'Weiterhin alle Belege vorhanden');
  d3.close(); neu2.p.kill();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fehler ? `\nFEHLGESCHLAGEN: ${fehler} Prüfung(en)` : '\nALLE PRÜFUNGEN BESTANDEN – bestehende Daten bleiben bei Updates erhalten.');
  process.exit(fehler ? 1 : 0);
})().catch(e => { console.error('Testfehler:', e.message); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (x) {} process.exit(1); });
