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

## Beleg fotografieren & automatisch erkennen

- **Beleg fotografieren** öffnet auf dem Handy direkt die Kamera. Das Foto wird sofort im Browser verkleinert
  (max. 2000 px, JPEG) – ein Foto von mehreren MB wird so zu ca. 100–400 KB und lädt auch bei langsamem Internet schnell hoch.
- Der Server liest per OCR (`tesseract.js`, läuft lokal, kein externer Dienst, Sprachdaten liegen im Paket) **Datum** und
  **Belegnummer** (letzte 3 Ziffern) aus dem Foto und trägt sie ein.
- Das Foto wird nur **einmal** hochgeladen; beim Speichern wird nur noch ein Kürzel gesendet.
- **✓ Verifiziert** ist ein Beleg nur, wenn Datum **und** Belegnummer aus dem Foto gelesen und unverändert übernommen wurden.
  Wer etwas von Hand tippt/ändert, PDFs hochlädt oder wenn nichts erkannt wird, bekommt den Status **Manuell**.
- Die Erkennung hängt von der Fotoqualität ab (flach, scharf, gut beleuchtet, ganzer Beleg im Bild). Bei Misserfolg bleibt
  die Handeingabe möglich. Der erste Scan nach einem Serverstart dauert etwas länger (OCR-Engine wird geladen).
