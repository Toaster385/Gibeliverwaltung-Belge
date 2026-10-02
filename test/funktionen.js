// Funktionstest der Server-Funktionen (frische Daten): Sicherheit, Papierkorb, Duplikate, Protokoll, Export, Fotos
//   npm run test:funktionen
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const repo = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gibeli-fn-'));
const PORT = 3921;
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mNk+M9Qz0AEYBxVSF+FAP5FDvcfRYWgAAAAAElFTkSuQmCC', 'base64');
let fehler = 0;
const kinder = [];
process.on('exit', () => kinder.forEach(k => { try { k.kill(); } catch (e) {} }));
const ok = (b, t) => { console.log((b ? '  ✓ ' : '  ✗ ') + t); if (!b) fehler++; };

function starte(extraEnv = {}) {
  const env = { ...process.env, PORT: String(PORT), DATA_DIR: path.join(tmp, 'data'), UPLOADS_DIR: path.join(tmp, 'uploads'), INITIAL_ADMIN_PASSWORD: 'Start-Passwort-1', ...extraEnv };
  const p = spawn('node', ['server.js'], { env, cwd: repo }); kinder.push(p);
  let log = ''; p.stdout.on('data', d => log += d); p.stderr.on('data', d => log += d);
  return new Promise((res, rej) => {
    const t = setInterval(async () => { try { await fetch(`http://localhost:${PORT}/healthz`); clearInterval(t); res({ p, log: () => log }); } catch (e) {} }, 200);
    p.on('exit', c => { clearInterval(t); rej(new Error('Server beendet:\n' + log)); });
    setTimeout(() => { clearInterval(t); rej(new Error('Timeout:\n' + log)); }, 30000);
  });
}
async function api(cookie, method, url, body, form, ip) {
  const opt = { method, headers: { cookie: cookie || '' } };
  if (ip) opt.headers['x-forwarded-for'] = ip;
  if (form) opt.body = form; else if (body) { opt.body = JSON.stringify(body); opt.headers['content-type'] = 'application/json'; }
  const r = await fetch(`http://localhost:${PORT}${url}`, opt);
  const buf = Buffer.from(await r.arrayBuffer());
  let json = null; try { json = JSON.parse(buf.toString()); } catch (e) {}
  return { status: r.status, headers: r.headers, cookie: (r.headers.get('set-cookie') || '').split(';')[0], json, text: buf.toString(), buf };
}
function beleg(felder, dateien = {}) {
  const f = new FormData();
  for (const [k, v] of Object.entries(felder)) f.append(k, v);
  if (dateien.haupt !== false) f.append('datei', new Blob([PNG], { type: 'image/png' }), 'haupt.png');
  (dateien.zusatz || []).forEach((n, i) => f.append('zusatz', new Blob([Buffer.concat([PNG, Buffer.from(String(i + 1))])], { type: 'image/png' }), n));
  return f;
}

// Test-Wetterdienst im Open-Meteo-Format (die Tests brauchen kein Internet)
let wetterAnfragen = 0, wetterAus = false;
const wetterServer = require('http').createServer((req, res) => {
  wetterAnfragen++;
  if (wetterAus) { res.statusCode = 500; return res.end('kaputt'); }
  const tage = ['2026-12-01', '2026-12-02', '2026-12-03', '2026-12-04', '2026-12-05', '2026-12-06', '2026-12-07'];
  const stunden = []; for (let h = 0; h < 48; h++) stunden.push(`2026-12-0${1 + Math.floor(h / 24)}T${String(h % 24).padStart(2, '0')}:00`);
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify({
    current: { time: '2026-12-01T10:15', temperature_2m: -3.4, apparent_temperature: -8.1, weather_code: 73, wind_speed_10m: 12.3, wind_gusts_10m: 30.1, is_day: 1, snow_depth: 0.42 },
    hourly: { time: stunden, temperature_2m: stunden.map(() => -3), precipitation_probability: stunden.map(() => 60), weather_code: stunden.map(() => 71), snowfall: stunden.map(() => 0.4) },
    daily: { time: tage, weather_code: tage.map(() => 73), temperature_2m_max: tage.map(() => 0.2), temperature_2m_min: tage.map(() => -6.7), precipitation_sum: tage.map(() => 3), snowfall_sum: tage.map(() => 4.5), sunrise: tage.map(t => t + 'T07:51'), sunset: tage.map(t => t + 'T16:43') }
  }));
});
wetterServer.listen(3931);
kinder.push({ kill: () => wetterServer.close() });

(async () => {
  console.log('Start mit leerer Datenbank …');
  let srv = await starte({ WETTER_URL: 'http://localhost:3931/v1/forecast' });
  ok(/ERSTER START/.test(srv.log()) || true, 'Server startet');
  const h = await api('', 'GET', '/healthz');
  ok(h.status === 200 && h.json.status === 'ok', 'Healthcheck /healthz antwortet');
  ok(h.headers.get('x-content-type-options') === 'nosniff' && h.headers.get('x-frame-options') === 'DENY', 'Sicherheits-Header gesetzt');

  console.log('Anmeldung & Sicherheit');
  let r = await api('', 'POST', '/api/login', { benutzername: 'Lio', passwort: 'Start-Passwort-1' });
  ok(r.status === 200 && r.json.passwortAendern === true, 'Erster Admin (Lio) mit Start-Passwort, muss Passwort ändern');
  let admin = r.cookie;
  r = await api(admin, 'PUT', '/api/admin/profil', { passwortAktuell: 'Start-Passwort-1', passwortNeu: 'Mein-Neues-Passwort-9' });
  ok(r.status === 200, 'Passwort geändert');
  r = await api(admin, 'GET', '/api/admin/belege');
  ok(r.status === 200, 'Danach voller Zugriff');
  ok(!/Admin2|Admin3/.test(JSON.stringify((await api(admin, 'GET', '/api/admin/benutzer')).json)), 'Keine festen Zusatz-Admins (Admin2/Admin3) mehr');

  await api(admin, 'POST', '/api/admin/benutzer', { benutzername: 'Anna', pin: '1111', rollen: ['gibeli-gast'] });
  await api(admin, 'POST', '/api/admin/benutzer', { benutzername: 'Bert', pin: '2222', rollen: ['gibeli-gast'] });
  await api(admin, 'POST', '/api/admin/benutzer', { benutzername: 'Vera', pin: '3333', rollen: ['verwaltung'] });
  const login = async (n, pin, ip) => api('', 'POST', '/api/login', { benutzername: n, pin }, null, ip);
  const anna = (await login('Anna', '1111', '10.0.0.1')).cookie, bert = (await login('Bert', '2222', '10.0.0.2')).cookie, vera = (await login('Vera', '3333', '10.0.0.3')).cookie;

  // Login-Sperre
  for (let i = 0; i < 5; i++) await login('Bert', '0000', '10.9.9.9');
  r = await login('Bert', '2222', '10.9.9.9');
  ok(r.status === 429 && /Minute/.test(r.json.error), 'Nach 5 Fehlversuchen wird gesperrt (auch mit richtigem PIN)');
  r = await login('Bert', '2222', '10.0.0.77');
  ok(r.status === 200, 'Derselbe Benutzer kann sich von einem anderen Gerät weiterhin anmelden (kein Aussperren per Fremdzugriff)');

  console.log('Belege erfassen');
  r = await api(anna, 'POST', '/api/belege', null, beleg({ datum: '2026-09-10', betrag: '25.50', waehrung: 'CHF', belegnummer: '123', geschaeft: 'Coop', clientId: 'c-1' }, { zusatz: ['seite2.png', 'seite3.png'] }));
  ok(r.status === 201 && r.json.zusatzFotos.length === 2, 'Beleg mit 2 Zusatzfotos gespeichert');
  const b1 = r.json;
  r = await api(anna, 'POST', '/api/belege', null, beleg({ datum: '2026-09-10', betrag: '25.50', waehrung: 'CHF', belegnummer: '123', geschaeft: 'Coop', clientId: 'c-1' }));
  ok(r.status === 200 && r.json.id === b1.id, 'Gleiche clientId (Wiederholung bei schlechtem Netz) erzeugt keinen zweiten Beleg');
  r = await api(anna, 'POST', '/api/belege', null, beleg({ datum: '2026-09-10', betrag: '25.50', waehrung: 'CHF', belegnummer: '123', geschaeft: 'Coop', clientId: 'c-2' }));
  ok(r.status === 409 && r.json.duplikat, 'Doppelter Beleg (Datum, Betrag, Nr.) wird erkannt');
  r = await api(anna, 'POST', '/api/belege', null, beleg({ datum: '2026-09-10', betrag: '25.50', waehrung: 'CHF', belegnummer: '123', clientId: 'c-3', duplikatOk: '1' }));
  ok(r.status === 201, 'Trotzdem speichern funktioniert nach Bestätigung');
  const b2 = r.json;
  r = await api(bert, 'POST', '/api/belege', null, beleg({ datum: '2026-09-11', betrag: '10', waehrung: 'EUR', belegnummer: '456', geschaeft: '=SUMME(A1)' }));
  const b3 = r.json;

  console.log('Zugriffsschutz auf Fotos');
  r = await api(anna, 'GET', '/uploads/' + b1.dateipfad); ok(r.status === 200, 'Besitzer sieht sein Foto');
  r = await api(anna, 'GET', '/uploads/' + b1.zusatzFotos[0].dateipfad); ok(r.status === 200, 'Besitzer sieht Zusatzfoto');
  r = await api(bert, 'GET', '/uploads/' + b1.dateipfad); ok(r.status === 403, 'Anderer Gast darf das Foto NICHT sehen');
  r = await api(vera, 'GET', '/uploads/' + b1.dateipfad); ok(r.status === 200, 'Verwaltung darf Fotos sehen');
  r = await api('', 'GET', '/uploads/' + b1.dateipfad); ok(!/^image/.test(r.headers.get('content-type') || ''), 'Ohne Anmeldung kein Zugriff (Weiterleitung zur Anmeldung)');
  r = await api(anna, 'GET', '/uploads/..%2fdata%2fbelege.db'); ok(r.status === 404 || r.status === 403, 'Kein Zugriff auf Dateien ausserhalb von uploads');

  console.log('Bearbeiten, Papierkorb, Wiederherstellen');
  const put = new FormData(); put.append('betrag', '30'); put.append('entferneFotos', JSON.stringify([b1.zusatzFotos[0].id]));
  r = await api(anna, 'PUT', '/api/belege/' + b1.id, null, put);
  ok(r.status === 200 && r.json.betrag === 30 && r.json.zusatzFotos.length === 1, 'Beleg bearbeiten + Zusatzfoto entfernen');
  r = await api(anna, 'DELETE', '/api/belege/' + b2.id);
  ok(r.status === 200 && r.json.papierkorb, 'Löschen verschiebt in den Papierkorb');
  r = await api(anna, 'GET', '/api/belege');
  ok(!r.json.some(b => b.id === b2.id), 'Gelöschter Beleg erscheint nicht mehr in der Liste');
  r = await api(anna, 'GET', '/uploads/' + b2.dateipfad); ok(r.status === 403, 'Gelöschter Beleg: Foto nur noch für Verwaltung');
  ok(fs.existsSync(path.join(tmp, 'uploads', b2.dateipfad)), 'Foto des gelöschten Belegs bleibt erhalten');
  r = await api(anna, 'GET', '/api/papierkorb'); ok(r.status === 403, 'Gäste sehen den Papierkorb nicht');
  r = await api(vera, 'GET', '/api/papierkorb');
  ok(r.status === 200 && r.json.length === 1 && r.json[0].verbleibendeTage >= 29, 'Verwaltung sieht Papierkorb (30 Tage Frist)');
  r = await api(vera, 'POST', `/api/papierkorb/${b2.id}/wiederherstellen`); ok(r.status === 200, 'Wiederherstellen');
  r = await api(anna, 'GET', '/api/belege'); ok(r.json.some(b => b.id === b2.id), 'Wiederhergestellter Beleg ist zurück');
  await api(anna, 'DELETE', '/api/belege/' + b2.id);
  r = await api(vera, 'DELETE', `/api/papierkorb/${b2.id}`); ok(r.status === 403, 'Endgültig löschen nur für Admins');
  r = await api(admin, 'DELETE', `/api/papierkorb/${b2.id}`); ok(r.status === 200 && !fs.existsSync(path.join(tmp, 'uploads', b2.dateipfad)), 'Admin löscht endgültig (Foto wird entfernt)');

  console.log('Benutzer löschen = Belege in den Papierkorb');
  const bertId = (await api(admin, 'GET', '/api/admin/benutzer')).json.find(u => u.benutzername === 'Bert').id;
  r = await api(admin, 'DELETE', '/api/admin/benutzer/' + bertId);
  ok(r.status === 200 && r.json.belegeImPapierkorb === 1, 'Beleg des gelöschten Benutzers landet im Papierkorb');
  r = await api(vera, 'GET', '/api/papierkorb'); ok(r.json.length === 1 && r.json[0].benutzername === '(gelöschter Benutzer)', 'Papierkorb zeigt den Beleg');
  r = await api(vera, 'POST', `/api/papierkorb/${b3.id}/wiederherstellen`); ok(r.status === 200, 'Beleg eines gelöschten Benutzers wiederherstellbar');

  console.log('PIN selbst ändern');
  r = await api(anna, 'PUT', '/api/ich/pin', { pinAlt: '9999', pinNeu: '4444' }); ok(r.status === 401, 'Falscher alter PIN wird abgelehnt');
  r = await api(anna, 'PUT', '/api/ich/pin', { pinAlt: '1111', pinNeu: '4444' }); ok(r.status === 200, 'PIN geändert');
  r = await login('Anna', '4444', '10.0.0.5'); ok(r.status === 200, 'Anmeldung mit neuem PIN');

  console.log('Excel-Bereiche (Belegung / Gerichte): Versionen, Rechte, Download');
  const xl = n => { const f = new FormData(); f.append('datei', new Blob(['xlsx-inhalt-' + n], { type: 'application/octet-stream' }), `datei${n}.xlsx`); return f; };
  r = await api(anna, 'POST', '/api/belegung', null, xl(1)); ok(r.status === 403, 'Gast darf keine Belegung hochladen');
  r = await api(vera, 'POST', '/api/gerichte', null, xl(1)); ok(r.status === 403, 'Verwaltung darf keine Gerichte hochladen (nur Rolle gerichte/Admin)');
  for (let i = 1; i <= 7; i++) { r = await api(vera, 'POST', '/api/belegung', null, xl(i)); }
  r = await api(vera, 'GET', '/api/belegung');
  ok(r.json.dateiname === 'datei7.xlsx' && r.json.hochgeladen_von === 'Vera' && r.json.kannSchreiben, 'Aktuelle Version + Hochgeladen von');
  ok(r.json.versionen.length === 5 && r.json.versionen[0].aktiv, 'Es bleiben genau die letzten 5 Versionen erhalten (7 hochgeladen)');
  const alt = r.json.versionen[2];
  r = await api(anna, 'GET', '/api/belegung'); ok(r.json.vorhanden && !r.json.kannSchreiben && !r.json.versionen, 'Gast sieht die Datei, aber keine Versionsliste');
  r = await api(anna, 'GET', `/api/belegung/datei?version=${alt.id}`); ok(r.status === 403, 'Gast kann keine frühere Version abrufen');
  r = await api(vera, 'GET', `/api/belegung/datei?version=${alt.id}&download=1`); ok(r.status === 200 && /attachment/.test(r.headers.get('content-disposition')) && r.text.startsWith('xlsx-inhalt'), 'Frühere Version herunterladbar (Download-Header)');
  r = await api(anna, 'GET', '/api/belegung/datei?download=1'); ok(r.status === 200 && /datei7\.xlsx/.test(r.headers.get('content-disposition')), 'Aktuelle Datei für alle herunterladbar mit Originalnamen');
  r = await api(anna, 'POST', `/api/belegung/versionen/${alt.id}/aktivieren`); ok(r.status === 403, 'Gast kann keine Version wiederherstellen');
  r = await api(vera, 'POST', `/api/belegung/versionen/${alt.id}/aktivieren`); ok(r.status === 200, 'Version wiederherstellen');
  r = await api(vera, 'GET', '/api/belegung'); ok(r.json.dateiname === alt.dateiname, 'Wiederhergestellte Version wird angezeigt');
  r = await api(vera, 'DELETE', `/api/belegung/versionen/${alt.id}`); ok(r.status === 400, 'Angezeigte Version kann nicht entfernt werden');
  r = await api(vera, 'DELETE', '/api/belegung'); r = await api(vera, 'GET', '/api/belegung');
  ok(!r.json.vorhanden && r.json.versionen.length === 5, 'Aus Anzeige entfernen: Versionen bleiben erhalten');
  const geliefert = r.json.versionen[0];
  r = await api(vera, 'POST', `/api/belegung/versionen/${geliefert.id}/aktivieren`); ok(r.status === 200, 'Nach dem Entfernen wiederherstellbar');
  r = await api(vera, 'PUT', '/api/belegung/spalten', { von: 'Anreise', bis: 'Abreise', name: 'Gruppe', personen: 'Personen', boese: 'x' });
  ok(r.status === 200 && r.json.spalten.von === 'Anreise' && !r.json.spalten.boese, 'Spaltenzuordnung speichern (nur bekannte Felder)');
  r = await api(anna, 'GET', '/api/belegung'); ok(r.json.spalten && r.json.spalten.bis === 'Abreise', 'Alle erhalten die Zuordnung (für die Übersicht „Im Gibeli“)');
  r = await api(anna, 'PUT', '/api/belegung/spalten', { von: 'x' }); ok(r.status === 403, 'Gast kann die Spalten nicht ändern');
  r = await api(admin, 'POST', '/api/gerichte', null, xl(9)); ok(r.status === 200, 'Admin darf Gerichte hochladen');
  const bad = new FormData(); bad.append('datei', new Blob(['x']), 'text.txt');
  r = await api(admin, 'POST', '/api/gerichte', null, bad); ok(r.status === 400 && r.json && r.json.error, 'Falscher Dateityp: Fehler als JSON (keine HTML-Seite)');

  console.log('Wetter');
  r = await api('', 'GET', '/api/wetter'); ok(r.status === 401, 'Wetter nur nach Anmeldung');
  r = await api(anna, 'GET', '/api/wetter');
  ok(r.status === 200 && r.json.ort === 'Achseten' && r.json.jetzt.temp === -3 && r.json.jetzt.schneehoeheCm === 42 && r.json.tage.length === 7 && r.json.tage[0].sonnenaufgang === '07:51', 'Wetter wird aufbereitet (Temperatur, Schneehöhe in cm, 7 Tage, Sonnenzeiten)');
  ok(r.json.stunden.length === 24 && r.json.stunden[0].zeit === '10:00', 'Stundenvorschau beginnt bei der aktuellen Stunde (24 Stunden)');
  const vorher = wetterAnfragen; await api(anna, 'GET', '/api/wetter'); await api(admin, 'GET', '/api/wetter');
  ok(wetterAnfragen === vorher, 'Weitere Abrufe kommen aus dem Zwischenspeicher (keine neuen Anfragen an den Wetterdienst)');

  console.log('Belegungsliste (Name, Personen, Von, Bis, Zimmer)');
  r = await api(anna, 'GET', '/api/belegung/liste'); ok(r.status === 200 && r.json.eintraege.length === 0 && !r.json.kannSchreiben, 'Gast sieht die (leere) Liste, ohne Schreibrecht');
  r = await api(anna, 'POST', '/api/belegung/liste', { name: 'X', von: '2026-04-01', bis: '2026-04-02' }); ok(r.status === 403, 'Gast darf keinen Eintrag anlegen');
  r = await api(vera, 'POST', '/api/belegung/liste', { name: 'Gruppe A', personen: 6, von: '2026-04-01', bis: '2026-04-05', zimmer: 'Zimmer 1' }); ok(r.status === 201, 'Verwaltung legt Eintrag an');
  const eid = r.json.id;
  r = await api(vera, 'POST', '/api/belegung/liste', { name: 'Falsch', von: '2026-04-05', bis: '2026-04-01' }); ok(r.status === 400, '„Bis“ vor „Von“ wird abgelehnt');
  r = await api(vera, 'POST', '/api/belegung/liste', { name: 'Falsch', von: '2026-13-45', bis: '2026-04-01' }); ok(r.status === 400, 'Ungültiges Datum wird abgelehnt');
  r = await api(vera, 'POST', '/api/belegung/liste', { name: '', von: '2026-04-01', bis: '2026-04-02' }); ok(r.status === 400, 'Name ist Pflicht');
  r = await api(vera, 'PUT', '/api/belegung/liste/' + eid, { name: 'Gruppe A', personen: 7, von: '2026-04-01', bis: '2026-04-06', zimmer: 'Zimmer 1' }); ok(r.status === 200, 'Eintrag ändern');
  r = await api(vera, 'POST', '/api/belegung/liste/import', { datei: 'test.xlsx', eintraege: [
    { name: 'B', personen: 2, von: '2026-05-01', bis: '2026-05-03', zimmer: 'Zimmer 2' }, { name: 'C', personen: null, von: '2026-05-02', bis: '2026-05-04', zimmer: '' }] });
  ok(r.status === 200 && r.json.anzahl === 2, 'Import ersetzt die Liste');
  r = await api(vera, 'GET', '/api/belegung/liste');
  ok(r.json.eintraege.length === 2 && r.json.staende.length === 1 && r.json.staende[0].anzahl === 1, 'Vorheriger Stand wurde gesichert');
  const stand = r.json.staende[0].id;
  r = await api(anna, 'POST', '/api/belegung/liste/import', { eintraege: [{ name: 'X', von: '2026-04-01', bis: '2026-04-02' }] }); ok(r.status === 403, 'Gast darf nicht importieren');
  r = await api(vera, 'POST', '/api/belegung/liste/import', { eintraege: [{ name: 'X', von: 'kaputt', bis: '2026-04-02' }] }); ok(r.status === 400, 'Import mit ungültigem Eintrag wird komplett abgelehnt');
  r = await api(vera, 'GET', '/api/belegung/liste'); ok(r.json.eintraege.length === 2, 'Abgelehnter Import lässt die Liste unverändert');
  r = await api(vera, 'POST', `/api/belegung/liste/staende/${stand}/wiederherstellen`); ok(r.status === 200 && r.json.anzahl === 1, 'Früheren Stand wiederherstellen');
  r = await api(vera, 'GET', '/api/belegung/liste'); ok(r.json.eintraege.length === 1 && r.json.eintraege[0].name === 'Gruppe A' && r.json.eintraege[0].personen === 7, 'Wiederhergestellte Liste stimmt (inkl. Änderung)');
  r = await api(vera, 'DELETE', '/api/belegung/liste/' + r.json.eintraege[0].id); ok(r.status === 200, 'Eintrag löschen');
  for (const e of [{ name: 'J1', von: '2026-03-01', bis: '2026-03-05' }, { name: 'J2', von: '2026-12-30', bis: '2027-01-02' }, { name: 'J3', von: '2027-06-01', bis: '2027-06-03' }]) await api(vera, 'POST', '/api/belegung/liste', e);
  r = await api(anna, 'DELETE', '/api/belegung/liste/jahr/2026'); ok(r.status === 403, 'Gast darf kein Jahr leeren');
  r = await api(vera, 'DELETE', '/api/belegung/liste/jahr/abc'); ok(r.status === 400, 'Ungültiges Jahr wird abgelehnt');
  r = await api(vera, 'DELETE', '/api/belegung/liste/jahr/2026'); ok(r.status === 200 && r.json.anzahl === 2, 'Jahr 2026 leeren: 2 Einträge (inkl. Jahreswechsel-Aufenthalt)');
  r = await api(vera, 'GET', '/api/belegung/liste'); ok(r.json.eintraege.length === 1 && r.json.eintraege[0].name === 'J3', 'Nur der Eintrag von 2027 bleibt');
  ok(r.json.staende.some(x => /vor dem Leeren von 2026/.test(x.grund)), 'Vor dem Leeren wurde der Stand gesichert');
  const vor = r.json.staende.find(x => /vor dem Leeren von 2026/.test(x.grund));
  r = await api(vera, 'POST', `/api/belegung/liste/staende/${vor.id}/wiederherstellen`); r = await api(vera, 'GET', '/api/belegung/liste');
  ok(r.json.eintraege.length === 3, 'Geleertes Jahr lässt sich über „Frühere Stände“ wiederherstellen');
  await api(vera, 'DELETE', '/api/belegung/liste/jahr/2026'); await api(vera, 'DELETE', '/api/belegung/liste/jahr/2027');

  console.log('Export & Protokoll');
  r = await api(anna, 'GET', '/api/export/belege.csv'); ok(r.status === 403, 'Export nur für Verwaltung/Admin');
  r = await api(vera, 'GET', '/api/export/belege.csv?von=2026-09-01&bis=2026-09-30&dezimal=komma');
  ok(r.status === 200 && r.text.startsWith('﻿') && /25,50|30,00/.test(r.text) && r.text.includes('Summe EUR'), 'CSV-Export mit Summen');
  ok(r.text.includes("'=SUMME(A1)"), 'CSV schützt vor Formel-Injection');
  r = await api(vera, 'GET', '/api/admin/protokoll'); ok(r.status === 403, 'Protokoll nur für Admins');
  r = await api(admin, 'GET', '/api/admin/protokoll?limit=500');
  const akt = r.json.eintraege.map(e => e.aktion);
  ok(['belegung_import', 'belegung_jahr_geleert', 'belegung_eintrag_neu', 'beleg_erstellt', 'beleg_geaendert', 'beleg_geloescht', 'beleg_wiederhergestellt', 'beleg_endgueltig_geloescht', 'benutzer_geloescht', 'export', 'login_gesperrt'].every(a => akt.includes(a)), 'Protokoll enthält alle wichtigen Aktionen: ' + [...new Set(akt)].join(', '));

  console.log('Neustart: nichts geht verloren');
  srv.p.kill(); await new Promise(r => setTimeout(r, 600));
  srv = await starte();
  r = await api('', 'POST', '/api/login', { benutzername: 'Lio', passwort: 'Mein-Neues-Passwort-9' }, null, '10.1.1.1');
  ok(r.status === 200 && r.json.passwortAendern === false, 'Neues Admin-Passwort gilt nach Neustart, Lio wird nicht neu angelegt');
  r = await api(r.cookie, 'GET', '/api/admin/belege'); ok(r.json.length === 2, 'Belege nach Neustart vorhanden (' + r.json.length + ')');

  console.log('E-Mail-Backup (Testmodus)');
  srv.p.kill(); await new Promise(r => setTimeout(r, 600));
  srv = await starte({ SMTP_HOST: 'json', BACKUP_EMAIL_TO: 'test@example.com' });
  const ad2 = (await api('', 'POST', '/api/login', { benutzername: 'Lio', passwort: 'Mein-Neues-Passwort-9' }, null, '10.1.1.2')).cookie;
  r = await api(ad2, 'POST', '/api/backup/email'.replace('/api/backup', '/api/admin/backup')); ok(r.status === 200 && r.json.gesendetAn === 'test@example.com', 'Backup per E-Mail wird versendet');
  r = await api(ad2, 'GET', '/api/admin/integritaet'); ok(r.json.email.konfiguriert && r.json.email.letzte, 'Status zeigt E-Mail-Backup');
  srv.p.kill();

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(fehler ? `\nFEHLGESCHLAGEN: ${fehler} Prüfung(en)` : '\nALLE PRÜFUNGEN BESTANDEN');
  process.exit(fehler ? 1 : 0);
})().catch(e => { console.error('Testfehler:', e.message); try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (x) {} process.exit(1); });
