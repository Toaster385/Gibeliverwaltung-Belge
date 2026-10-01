// LAN-Modus: lädt optional .env, startet server.js und zeigt die WLAN-Adresse an.
// Nur für `npm run start:lan`. `npm start` / Railway nutzen weiterhin direkt server.js.
const fs = require('fs');
const os = require('os');
const path = require('path');

// Mini-.env-Loader (bereits gesetzte Umgebungsvariablen haben Vorrang)
const envFile = path.join(__dirname, '.env');
if (fs.existsSync(envFile)) {
  for (const line of fs.readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const val = m[2].replace(/^(['"])(.*)\1$/, '$2');
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

process.env.PORT = process.env.PORT || '3000';

require('./server.js'); // lauscht auf 0.0.0.0:PORT

const ips = [];
for (const list of Object.values(os.networkInterfaces())) {
  for (const i of list || []) {
    if (i.family === 'IPv4' && !i.internal) ips.push(i.address);
  }
}
if (ips.length === 0) {
  console.log('Keine Netzwerkadresse gefunden – bist du mit dem WLAN verbunden?');
} else {
  for (const ip of ips) console.log(`Erreichbar im WLAN unter: http://${ip}:${process.env.PORT}`);
}
