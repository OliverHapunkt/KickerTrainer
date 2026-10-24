# KickerTrainer

Web-App für gezieltes Tischfußball-Training: Schüsse und Pässe üben, Treffer erfassen, Schwächen in der Statistik finden. Läuft komplett im Browser, optimiert für das iPad am Kickertisch.

![Version](https://img.shields.io/badge/version-3.1.0-green)
![Platform](https://img.shields.io/badge/platform-iPad%20%7C%20Web-orange)

Die aktuelle Version steht auf dem Home-Screen ganz unten (z. B. `v3.1.0 · 2026-10-24`). Nach einem Deploy kannst du dort prüfen, ob dein Gerät die neue Version geladen hat.

---

## Features

### Disziplinen
- **Schuss 3er** – Techniken: Pull, Push, Snake, Tic-Tac, Frei
- **Schuss 2er** – Gerade, Bande, Lücke, Frei
- **Pass 5er→3er** – Brush, Stick, Kick, Bande, Frei
- **Pass 2er→5er** und **Pass 2er→3er** – Gerade, Bande, Frei
- **Kombi Pass+Schuss** – Pass und Schuss in einer Wiederholung

### Ziele
- Schuss: Tor-Segment 1–5 (1 = links aus Sicht des Schützen) oder „Tor (egal)“
- Pass: Wall, Lane oder „Egal“
- Ziele werden per Sprachansage genannt (Schuss: nur die Zahl, Pass: „wall“ / „lane“)

### Trainingssteuerung
- **Reihenfolge:** Gemischt, Serie oder **Schwachstellen** (schwache Ziele und Techniken kommen häufiger, Datenbasis: letzte 5/10/20 Sessions)
- **Timing:** Freies Tempo oder **Auf Signal** (Ziel kommt zufällig innerhalb der Regelzeit, danach bleibt nur das Reaktionsfenster von 1 bis 3 s)
- **Wertung Schuss:** Einfach (Treffer/Daneben) oder Genau (Segment tippen)
- **Umfang:** 10/20/30/50 Wiederholungen oder 5/10/15 Minuten
- **Trainingsplan:** Mehrere Konfigurationen hintereinander, Start mit „Plan starten“

### Schusserkennung (optional)
- Erkennung über **Ton**, **Erschütterung** (iPad direkt auf dem Tisch), **Ton + Erschütterung** oder **Ton oder Erschütterung**
- „Ton + Erschütterung“ löst am seltensten fälschlich aus (Stimmen, Nachbartisch)
- Erkannte Schüsse zählen automatisch als Treffer, im Korrekturfenster (2/3/5 s) wird korrigiert
- Reaktionszeiten werden nur mit aktiver Schusserkennung gemessen
- Empfindlichkeit für Ton und Erschütterung einstellbar
- Testseite für Mikrofon, Sprachansage und Spracheingabe

### Spracheingabe (Beta)
- Erkannte Wörter: „Ja“, „eins“ bis „fünf“, „Treffer“, „daneben“, „gefangen“, „verloren“
- Nur verfügbar, wenn der Browser Spracherkennung unterstützt

### Statistik
- Zeitraum: Letzte Session, Heute, 7 Tage, 30 Tage, Alles
- Filter nach Disziplin, Technik und Timing (frei / auf Signal)
- Erfolgsquote mit Vergleich zum vorherigen Zeitraum, Anzahl Aktionen, Sessions, Minuten
- Verlauf über Sessions bzw. innerhalb einer Session
- Torkarte und Segment-Matrix (Schüsse)
- Auswertung je Technik und Technik × Ziel
- Kombi: Auswertung Pass → Tor
- Reaktionszeit-Auswertung
- Vergleich „frei vs. auf Signal“
- Kalenderansicht und Session-Liste mit Notizen; einzelne Sessions können aus der Wertung ausgeschlossen werden

### Daten
- Alles liegt lokal im Browser (`localStorage`), es gibt kein Backend
- **Sichern (JSON)**, **Tabelle (CSV)**, **Importieren (zusammenführen)** – Duplikate werden erkannt, so lassen sich Daten zwischen iPad und iPhone übertragen
- **Alle Daten löschen** (mit doppelter Rückfrage)

---

## Technik

- Eine einzige Datei: `index.html` mit eingebettetem CSS und JavaScript (Vanilla JS, keine Abhängigkeiten, kein Build-Schritt)
- Web Audio API (Signaltöne, Schusserkennung), Web Speech API (Ansage, Spracheingabe), DeviceMotion (Erschütterung)
- Hosting: GitHub Pages, Deployment per GitHub Actions bei jedem Push auf `main` (`.github/workflows/deploy.yml`)

### Datenspeicher

| Schlüssel | Inhalt |
|---|---|
| `kt2_data` | `{ v: 2, sessions: [...], shots: [...] }` – alle Sessions und Einzelaktionen |
| `kt2_settings` | Konfiguration, Trainingsplan, Optionen (Sprache, Erkennung, Empfindlichkeit) |

Ältere Daten (Schema v1) werden beim Start automatisch auf v2 migriert.

### Altbestand im Repo

`app.js`, `audio-system.js`, `stats.js`, `timer-mode.js` und `styles.css` gehören zu einer früheren, modularen Version. Sie werden von `index.html` **nicht** geladen und haben keinen Einfluss auf die App. Maßgeblich ist ausschließlich `index.html`.

---

## Installation und Entwicklung

### Nutzung auf dem iPad
1. Die App-URL in Safari öffnen
2. „Zum Home-Bildschirm“ hinzufügen – sonst kann Safari lokale Daten nach 7 Tagen ohne Besuch löschen
3. Mikrofon-Zugriff erlauben, wenn Schusserkennung genutzt wird (iOS: Einstellungen › Safari › Mikrofon)

### Lokal starten
```bash
git clone https://github.com/OliverHapunkt/KickerTrainer.git
cd KickerTrainer
python3 -m http.server 8000
# dann http://localhost:8000 öffnen
```
Mikrofon und Bewegungssensoren funktionieren nur über HTTPS oder `localhost`.

### Versionierung
- Version und Datum stehen in `index.html` in den Konstanten `APP_VERSION` und `APP_DATE`
- Bei jeder Änderung hochzählen und das Badge in dieser README anpassen
- Schema: Patch (`3.1.x`) für Fixes, Minor (`3.x.0`) für neue Funktionen, Major für Datenmodell-Änderungen

### Arbeitsweise
- Änderungen auf einem Feature-Branch, Merge nach `main` erst nach Test auf dem Gerät
- Ein Push auf `main` deployt sofort live

---

## Bekannte Einschränkungen

- Kein Service Worker: Die App ist nicht garantiert offline nutzbar, und iOS cached Home-Screen-Apps teilweise hartnäckig (Version prüfen!)
- Daten sind an Browser und Gerät gebunden; ohne regelmäßiges Sichern (JSON) gehen sie bei gelöschten Website-Daten verloren
- Spracheingabe ist Beta und browserabhängig
- Erschütterungserkennung setzt voraus, dass das iPad direkt auf dem Tisch liegt

## Roadmap

- Migration auf React als PWA (mit Service Worker und Offline-Betrieb)
- Altbestand entfernen oder in `legacy/` verschieben
- Optional: Cloud-Sync statt manuellem Export/Import
