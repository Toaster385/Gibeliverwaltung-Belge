# Gibeliverwaltung Belge

Einkaufsbeleg-Verwaltung (Express + SQLite).

## Betrieb auf Railway

Unverändert: `npm start` / `node server.js` (siehe `railway.json`).

## LAN-Modus (lokal auf dem Mac, Zugriff im WLAN)

Alternative zu Railway. Die Daten sind komplett getrennt von Railway. Der LAN-Modus nutzt denselben Code wie Railway –
alle Funktionen (PIN-Login, Belegerkennung, Gerichte, Datensicherheit) sind identisch.

### Einmalig einrichten

1. Node.js installieren (https://nodejs.org, Version 20 oder neuer) und Terminal öffnen.
2. Projekt holen: `git clone https://github.com/Toaster385/Gibeliverwaltung-Belge.git` und `cd Gibeliverwaltung-Belge`
3. `npm install`
4. `cp .env.example .env` und in `.env` bei `SESSION_SECRET` einen eigenen Wert eintragen.

### Starten

```bash
caffeinate -i npm run start:lan
```

Beim Start erscheint z. B.:

```
Erreichbar im WLAN unter: http://192.168.1.23:3000
```

Diese Adresse auf dem Handy/Laptop im **gleichen WLAN** im Browser öffnen. Auf dem Mac selbst geht auch `http://localhost:3000`.
Der Port lässt sich über `PORT` in `.env` ändern (Standard 3000).

### Aktualisieren (neue Version holen)

```bash
git pull
npm install
```

Danach wie gewohnt starten. Die Daten bleiben erhalten: Beim Start wird automatisch eine Sicherung angelegt (siehe Datensicherheit).

### Mac wach halten

`caffeinate -i npm run start:lan` verhindert den Ruhezustand, solange der Server läuft (Terminal offen lassen).

### macOS-Firewall

Beim ersten Start fragt macOS ggf. „Möchtest du, dass `node` eingehende Verbindungen akzeptiert?“ → **Erlauben**.
Bei Problemen: Systemeinstellungen → Netzwerk → Firewall → Optionen → `node` auf „Eingehende Verbindungen erlauben“ setzen.
Manche WLANs (Gast-WLAN, Firmen-WLAN) blockieren Verbindungen zwischen Geräten („Client Isolation“).

### Nur http

Der LAN-Modus läuft ohne Verschlüsselung (**http, kein https**). Nur in vertrauenswürdigen Netzen nutzen.
Die Kamera-Funktion „Beleg fotografieren“ öffnet auf dem Handy die Kamera-App, das funktioniert auch über http.

### Wo liegen die Daten?

| Was | Ort (Standard) |
| --- | --- |
| Datenbank (Benutzer, Belege, Sessions) | `./data/belege.db` |
| Beleg-Fotos | `./uploads/` |
| Belegung / Gerichte (Excel) | `./data/belegung/`, `./data/gerichte/` |
| Automatische Sicherungen | `./data/backups/` |

Lokal startet die App mit leerer Datenbank; Daten aus Railway müssen bei Bedarf manuell kopiert werden
(Admin-Bereich auf Railway → „Alles herunterladen (ZIP)“, dann `belege.db` nach `data/` und den Ordner `uploads/` entpacken).

### Wichtig: Standard-Admins

Beim ersten Start legt die App die Admins `Lio`, `Admin2` und `Admin3` mit Standardpasswörtern an.
Passwörter nach dem ersten Login ändern, bevor andere im WLAN zugreifen. Gäste brauchen einen 4-stelligen PIN
(Admin-Bereich → Benutzerverwaltung).

## Datensicherheit (Belege dürfen bei Änderungen nie verloren gehen)

**Was automatisch passiert**
- Bei **jedem Serverstart** (also bei jedem Update/Deploy) wird *vor* allen Änderungen eine Kopie der Datenbank in `backups/` angelegt (die letzten 10 bleiben erhalten). Schlägt das fehl, startet der Server nicht und ändert nichts.
- Zusätzlich **täglich** eine Sicherung (die letzten 14).
- **Notbremse:** Würde nach einem Update die Zahl der Belege oder Benutzer kleiner sein als vorher, bricht der Start ab.
- Datenbank-Änderungen sind ausschliesslich *hinzufügend* (neue Spalten); nichts wird gelöscht oder überschrieben.
- Im Admin-Bereich zeigt die Karte **Datensicherheit** den Zustand: Datenbank ok, alle Belegfotos vorhanden, letzte Sicherung. Dort gibt es **Jetzt Sicherung anlegen** und **Alles herunterladen (ZIP)** (Datenbank + alle Belegfotos).

**Garantie-Test (vor jedem Update ausführen)**

```bash
npm run test:daten
```

Der Test speichert Belege mit der *alten* Originalversion (`test/fixtures/legacy-server.js`), startet danach die aktuelle Version auf denselben Daten und prüft: gleiche Anzahl, jedes Feld jedes Belegs unverändert, jedes Foto Byte für Byte identisch, Sicherung vorhanden, ZIP-Export funktioniert.

**Railway: Volume ist Pflicht!** Dateien im Container sind nach jedem Deploy weg. Damit Belege dauerhaft bleiben:
1. Railway → Service → *Settings* → *Volumes* → neues Volume, Mount-Pfad `/data`.
2. *Variables*: `DATA_DIR=/data` und `UPLOADS_DIR=/data/uploads`.
3. Im Admin-Bereich muss in der Karte „Datensicherheit“ stehen: *Daten liegen auf einem dauerhaften Railway-Volume*. Ist das nicht der Fall, erscheint eine rote Warnung.

**Wiederherstellen**
1. Server stoppen.
2. `node restore.js` zeigt die vorhandenen Sicherungen, `node restore.js data/backups/<Datei>.db` stellt die Datenbank wieder her (die aktuelle wird vorher als `belege.db.vor-restore-…` gesichert).
3. Server starten. Belegfotos liegen unverändert in `uploads/` (bei einem ZIP-Export: Ordner `uploads/` zurückkopieren).

## Beleg fotografieren & automatisch erkennen

- **Beleg fotografieren** öffnet auf dem Handy direkt die Kamera. Das Foto wird sofort im Browser verkleinert
  (max. 2400 px, JPEG) – ein Foto von mehreren MB wird so zu ca. 100–400 KB und lädt auch bei langsamem Internet schnell hoch.
- Der Server liest per OCR (`tesseract.js`, läuft lokal, kein externer Dienst, Sprachdaten liegen im Paket) **Datum** und
  **Belegnummer** (letzte 3 Ziffern) aus dem Foto und trägt sie ein.
- Das Foto wird nur **einmal** hochgeladen; beim Speichern wird nur noch ein Kürzel gesendet.
- **✓ Verifiziert** ist ein Beleg nur, wenn Datum **und** Belegnummer aus dem Foto gelesen und unverändert übernommen wurden.
  Wer etwas von Hand tippt/ändert, PDFs hochlädt oder wenn nichts erkannt wird, bekommt den Status **Manuell**.
- Die Erkennung hängt von der Fotoqualität ab (flach, scharf, gut beleuchtet, ganzer Beleg im Bild). Bei Misserfolg bleibt
  die Handeingabe möglich. Der erste Scan nach einem Serverstart dauert etwas länger (OCR-Engine wird geladen).

## Rollen und Tabellen (Aktuelle Belegung / Gerichte)

| Rolle | Darf |
| --- | --- |
| `gibeli-gast` | Eigene Belege verwalten, Belegung und Gerichte ansehen |
| `verwaltung` | Alle Belege einsehen/Status ändern, Belegung hochladen/ersetzen/löschen |
| `gerichte` | Gerichte-Tabelle (Excel) hochladen/ersetzen/löschen |
| `admin` | Alles |

Die Gerichte-Tabelle funktioniert wie die Belegung: alle Angemeldeten sehen sie über das Menü (⋮ → Gerichte),
die Rolle `gerichte` (und Admins) können die Excel-Datei (.xlsx, .xls, .ods) hochladen. Rollen werden in der
Benutzerverwaltung im Admin-Bereich vergeben; ein Benutzer kann mehrere Rollen haben.
