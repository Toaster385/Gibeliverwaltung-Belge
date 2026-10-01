# Gibeliverwaltung Belge

Einkaufsbeleg-Verwaltung (Express + SQLite).

## Betrieb auf Railway

Unverändert: `npm start` / `node server.js` (siehe `railway.json`).

## LAN-Modus (lokal auf dem Mac, Zugriff im WLAN)

Alternative zu Railway. Die Daten sind komplett getrennt von Railway.

### Starten

```bash
npm install
cp .env.example .env     # einmalig, Werte anpassen (mind. SESSION_SECRET)
npm run start:lan
```

Beim Start erscheint z. B.:

```
Erreichbar im WLAN unter: http://192.168.1.23:3000
```

Der Port lässt sich über `PORT` in `.env` oder `PORT=8080 npm run start:lan` ändern (Standard 3000).

### Zugriff von anderen Geräten

Smartphone/Tablet/Laptop müssen im **gleichen WLAN** sein. Dort im Browser die ausgegebene Adresse öffnen.
Auf dem Mac selbst geht auch `http://localhost:3000`.

### Mac wach halten

Wenn der Mac schläft, ist die App nicht erreichbar:

```bash
caffeinate -i npm run start:lan
```

`caffeinate -i` verhindert den Ruhezustand, solange der Server läuft.

### macOS-Firewall

Beim ersten Start fragt macOS ggf. „Möchtest du, dass `node` eingehende Verbindungen akzeptiert?“ → **Erlauben**.
Bei Problemen: Systemeinstellungen → Netzwerk → Firewall → Optionen → `node` auf „Eingehende Verbindungen erlauben“ setzen.
Manche WLANs (Gast-WLAN, Firmen-WLAN) blockieren Verbindungen zwischen Geräten („Client Isolation“).

### Nur http

Der LAN-Modus läuft ohne Verschlüsselung (**http, kein https**). Passwörter und Belege gehen unverschlüsselt durchs WLAN –
nur in vertrauenswürdigen Netzen nutzen. Browser-Funktionen, die https verlangen, sind evtl. eingeschränkt.

### Wo liegen die Daten?

| Was | Ort (Standard) |
| --- | --- |
| Datenbank (Benutzer, Belege, Sessions) | `./data/belege.db` |
| Beleg-Uploads | `./uploads/` |
| Belegungs-Excel | `./data/belegung/` |

Beide Ordner sind in `.gitignore`. Lokal startet die App mit leerer Datenbank; Daten aus Railway
müssen bei Bedarf manuell kopiert werden.

### Wichtig: Standard-Admins

Beim ersten Start legt die App die Admins `Lio`, `Admin2` und `Admin3` mit Standardpasswörtern an.
Passwörter nach dem ersten Login ändern, bevor andere im WLAN zugreifen.
