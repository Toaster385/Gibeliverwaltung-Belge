# Gibeliverwaltung Belge

Belegverwaltung für das Vereinsheim Gibeli (TV Lorraine-Breitenrain Bern, Achseten 1285 m ü. M.).
Express + SQLite, läuft auf Railway oder lokal im WLAN.

## Aufbau

| Ordner / Datei | Inhalt |
| --- | --- |
| `server.js` | Start, Sicherheits-Header, Sitzungen, Einbindung der Routen |
| `lib/` | Konfiguration, Datenbank + Migrationen, Anmeldung/Sperre, Protokoll, Sitzungen, E-Mail-Backup |
| `routes/` | `auth`, `benutzer`, `belege` (inkl. Papierkorb, Scan, Export), `admin`, `excel` (Belegung/Gerichte) |
| `scan.js` | Belegerkennung (OCR + Auswertung) |
| `datensicherheit.js` | Sicherungen, Integritätsprüfung, ZIP-Export |
| `public/` | Oberfläche (Schriften und Excel-Bibliothek liegen lokal in `fonts/` und `vendor/`) |
| `test/` | Automatische Tests |

## Rollen

| Rolle | Darf |
| --- | --- |
| `gibeli-gast` | Eigene Belege erfassen/bearbeiten/löschen (Papierkorb), Belegung und Gerichte ansehen, eigenen PIN ändern |
| `verwaltung` | Alle Belege einsehen, Status ändern, Belegung hochladen, Papierkorb (wiederherstellen), CSV-Export |
| `gerichte` | Gerichte-Tabelle (Excel) hochladen/ersetzen/löschen |
| `admin` | Alles, dazu Benutzer, Perioden, Kasse, Protokoll, Backups, Papierkorb endgültig leeren |

Gäste melden sich mit Benutzername + **4-stelligem PIN** an, Admins mit Passwort (mind. 8 Zeichen).

## Railway (Produktion)

**Pflicht – Volume:** Dateien im Container sind nach jedem Deploy weg. Damit Belege dauerhaft bleiben:
1. Railway → Service → *Settings* → *Volumes* → neues Volume, Mount-Pfad `/data`.
2. *Variables*: `DATA_DIR=/data` und `UPLOADS_DIR=/data/uploads`.
3. Im Admin-Bereich muss in der Karte „Datensicherheit“ stehen: *Daten liegen auf einem dauerhaften Railway-Volume*. Sonst erscheint eine rote Warnung.

Weitere Variablen (alle optional): `SESSION_SECRET`, `INITIAL_ADMIN_NAME`, `INITIAL_ADMIN_PASSWORD`, `BACKUP_EMAIL_TO` + `SMTP_*` (siehe `.env.example`).
Start über `node server.js`; Railway prüft `/healthz` (siehe `railway.json`).

**Erster Start / Admin-Konten:** Admins werden nicht mehr bei jedem Start mit festen Passwörtern angelegt. Gibt es noch keinen Admin,
wird `Lio` mit einem Zufallspasswort (steht einmalig im Startprotokoll, bzw. `INITIAL_ADMIN_PASSWORD`) erzeugt. Bestehende Admins mit dem
früheren Standardpasswort (2202/1111) müssen es beim nächsten Login ändern. Passwort vergessen: `node reset-admin.js <Name> <NeuesPasswort>`.

## Sicherheit
- Login-Sperre: 5 Fehlversuche je Gerät und Benutzername → 15 Minuten gesperrt (zusätzlich Obergrenzen je Benutzer und IP).
- Sitzungs-Geheimnis wird zufällig erzeugt, falls `SESSION_SECRET` fehlt; Cookies `httpOnly`, `sameSite`, bei https `secure`.
- Belegfotos sehen nur Besitzer und Verwaltung/Admin (kein Zugriff auf fremde Fotos, auch nicht mit bekanntem Dateinamen).
- Sicherheits-Header (`nosniff`, kein Einbetten in fremde Seiten, …).

## Datensicherheit (Belege dürfen bei Änderungen nie verloren gehen)

**Automatisch**
- Bei **jedem Serverstart** (= bei jedem Update) wird *vor* allen Änderungen eine Kopie der Datenbank in `backups/` angelegt (letzte 10). Schlägt das fehl, startet der Server nicht.
- **Täglich** eine weitere Sicherung (letzte 14).
- **Notbremse:** Wären nach einem Update weniger Belege/Benutzer vorhanden als vorher, bricht der Start ab.
- Datenbank-Änderungen sind ausschliesslich *hinzufügend*. **Löschen verschiebt in den Papierkorb** (30 Tage wiederherstellbar, danach automatisch endgültig entfernt); auch das Löschen eines Benutzers entfernt dessen Belege nicht endgültig.
- Admin-Bereich → Karte **Datensicherheit**: Zustand, *Jetzt Sicherung anlegen*, *Alles herunterladen (ZIP)* (Datenbank + alle Fotos), *Backup per E-Mail senden*.
- **E-Mail-Backup** (optional, schützt auch bei Verlust des Volumes): mit `BACKUP_EMAIL_TO` und `SMTP_*` wird wöchentlich automatisch Datenbank + Fotos (bis ca. 18 MB, sonst nur die Datenbank) gemailt.
- **Änderungsprotokoll** (Admin → Protokoll): Wer hat wann welchen Beleg erstellt/geändert/gelöscht, Status, Benutzer, Perioden, Exporte, Backups.

**Tests (vor jedem Update ausführen)**
```bash
npm test
```
- `test:daten`: speichert Belege mit der *alten* Originalversion (`test/fixtures/legacy-server.js`), startet die aktuelle Version auf denselben Daten und prüft: jedes Feld jedes Belegs unverändert, jedes Foto Byte für Byte identisch, Sicherung vorhanden, ZIP-Export funktioniert.
- `test:funktionen`: Anmeldung/Sperre, Zugriffsschutz, Papierkorb, Duplikate, Mehrfachfotos, Export, Protokoll, E-Mail-Backup.
- `test:erkennung`: Texterkennung an typischen Kassenzetteln. GitHub Actions führt `npm test` bei jedem Push aus.

**Wiederherstellen:** Server stoppen, `node restore.js` zeigt die Sicherungen, `node restore.js data/backups/<Datei>.db` stellt die Datenbank wieder her
(die aktuelle wird vorher als `belege.db.vor-restore-…` gesichert), Server starten. Fotos liegen unverändert in `uploads/`.

## Beleg erfassen
- **Beleg fotografieren** öffnet auf dem Handy die Kamera. Das Foto wird sofort im Browser verkleinert (max. 2400 px, JPEG, meist 100–400 KB) und nur **einmal** hochgeladen.
- Der Server liest per OCR (`tesseract.js`, lokal, kein externer Dienst) **Datum, Belegnummer (letzte 3 Ziffern), Betrag, Währung und Geschäft** und trägt sie ein.
- **✓ Verifiziert** = Datum und Belegnummer wurden aus dem Foto gelesen und unverändert übernommen (vom Server entschieden). Alles andere ist **Manuell**. Admins/Verwaltung sehen, welche Werte automatisch gelesen wurden.
- Nicht (vollständig) erkannte Fotos werden mit dem erkannten Text im Protokoll festgehalten – so lässt sich die Erkennung gezielt verbessern (kein Foto wird gespeichert).
- **Mehrere Fotos** pro Beleg (z. B. lange Kassenzettel, bis 5 weitere). **Doppelte Belege** (gleiches Datum, Betrag, Währung, Nummer) werden erkannt und müssen bestätigt werden.
- **Schlechtes/kein Internet:** Neue Belege werden im Browser zwischengespeichert und automatisch gesendet, sobald wieder Verbindung besteht (ohne Doppelspeicherung). Die App lässt sich auf dem Startbildschirm installieren und startet auch offline.
- **Export für die Buchhaltung:** Menü (⋮) → *Export (CSV)* für Verwaltung/Admin (Zeitraum oder aktive Periode, öffnet direkt in Excel).

## Aktuelle Belegung, Gerichte und „Im Gibeli“

**Aktuelle Belegung** hat drei Ansichten (Menü ⋮):
- **Liste:** pro Aufenthalt eine Zeile – **Name, Personen, Von, Bis, Zimmer** (mit „im Haus“ / „kommt in 3 Tagen“), Filter *Aktuell & kommend / Alle / Vergangen*, Suche. Auf dem Handy als Karten.
- **Pro Tag:** wie viele Personen an welchem Tag im Haus sind und wer (z. B. für die Essensplanung), mit der höchsten Belegung.
- **Excel-Datei:** die hochgeladene Originaldatei als Tabelle im Website-Design (Blätter als Reiter, Suche, Download, Datum richtig angezeigt).

**Excel einlesen:** Verwaltung/Admin wählen in der Liste „Excel einlesen“. Die Datei wird im Browser ausgewertet, es erscheint eine **Vorschau** (bitte prüfen), dann ersetzt „Liste ersetzen“ die Liste. Die bisherige Liste wird vorher gesichert (*Frühere Stände*, letzte 10, wiederherstellbar) und die Originaldatei als Version abgelegt (letzte 5).
Erkannt werden:
1. das **Zimmer-Raster** (links Datum, rechts die Zimmer, darüber die Kapazität, darunter die Gäste): Steht ein Name an mehreren Tagen hintereinander, ist das ein Aufenthalt. `Name` = 1 Person, `Name 4` = 4 Personen, `Anna & Ben` = 2 Personen, `X Ab / Y An` bzw. `X / Y` = Wechsel am selben Tag, `Name 4` über mehrere Massenlager-Plätze = ein Aufenthalt (nicht mehrfach gezählt).
2. eine **einfache Liste** mit den Spalten Anreise/Abreise (oder Von/Bis), Name, Personen, Zimmer.

Die Liste lässt sich auch direkt in der App pflegen (**+ Eintrag**, **Bearbeiten**, **Löschen**); alle Änderungen stehen im Protokoll.

**Karte „Im Gibeli“** (oben auf der Startseite und im Admin-Bereich): **wie viele Personen zurzeit im Haus sind**, **nächste Abreise** und **nächste Anreise** (aus der Liste, ohne dass Excel geladen werden muss).

**Gerichte** (Menü ⋮): Excel-Datei als Tabelle (Blätter als Reiter, Suche, Download, Versionen). Hochladen darf die Rolle `gerichte` und Admin.
Beim Ersetzen von Excel-Dateien bleiben die letzten 5 Versionen erhalten und lassen sich wiederherstellen.

## LAN-Modus (lokal auf dem Mac, Zugriff im WLAN)

Alternative zu Railway, gleicher Code und alle Funktionen, **Daten komplett getrennt von Railway**.

**Einmalig einrichten**
1. Node.js installieren (https://nodejs.org, Version 20 oder neuer) und Terminal öffnen.
2. `git clone https://github.com/Toaster385/Gibeliverwaltung-Belge.git` und `cd Gibeliverwaltung-Belge`
3. `npm install`
4. `cp .env.example .env` (optional anpassen).

**Starten**
```bash
caffeinate -i npm run start:lan
```
Beim ersten Start steht im Terminal das **Start-Passwort für Admin Lio** (nur einmal sichtbar, muss beim ersten Login geändert werden).
Danach erscheint z. B. `Erreichbar im WLAN unter: http://192.168.1.23:3000` – diese Adresse auf dem Handy im **gleichen WLAN** öffnen
(Admin-Bereich: `/admin.html`). Der Port lässt sich über `PORT` in `.env` ändern.

**Aktualisieren:** `git pull` und `npm install`; die Daten bleiben erhalten (automatische Sicherung beim Start).
**Mac wach halten:** `caffeinate -i` verhindert den Ruhezustand, solange der Server läuft.
**macOS-Firewall:** Beim ersten Start „Erlauben“ für `node` wählen (Systemeinstellungen → Netzwerk → Firewall → Optionen). Manche WLANs (Gast-/Firmen-WLAN) blockieren Verbindungen zwischen Geräten.
**Nur http:** Der LAN-Modus läuft unverschlüsselt – nur in vertrauenswürdigen Netzen nutzen. Kamera, Offline-Warteschlange und Installation als App funktionieren auch über die lokale Adresse.

| Was | Ort (Standard) |
| --- | --- |
| Datenbank | `./data/belege.db` |
| Belegfotos | `./uploads/` |
| Belegung / Gerichte (Excel) | `./data/belegung/`, `./data/gerichte/` |
| Sicherungen | `./data/backups/` |

Daten aus Railway übernehmen: Admin-Bereich auf Railway → *Alles herunterladen (ZIP)*, entpacken und `belege.db` nach `data/`, den Ordner `uploads/` nach `uploads/` kopieren.
