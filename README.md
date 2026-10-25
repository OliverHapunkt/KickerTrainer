# KickerTrainer

Web-App für gezieltes Tischfußball-Training: Schüsse und Pässe üben, Treffer erfassen, Schwächen in der Statistik finden. Läuft komplett im Browser, optimiert für das iPad am Kickertisch.

![Version](https://img.shields.io/badge/version-3.7.0-green)
![Platform](https://img.shields.io/badge/platform-iPad%20%7C%20Web-orange)

Die aktuelle Version steht auf dem Home-Screen ganz unten (z. B. `v3.7.0 · 2026-10-25`). Nach einem Deploy kannst du dort prüfen, ob dein Gerät die neue Version geladen hat.

---

## Features

### Bedienung
- **Tab-Leiste:** Training · Challenges · Statistik · Einstellungen (während des Trainings ausgeblendet)
- **Training:** Hauptkarte „Aktuelle Übung“ mit Start und „+ Plan“ ganz oben, Konfiguration über „Anpassen“; Level als Abzeichen neben der Überschrift (antippen = Details)
- **Meine Übungen:** eine Übung hat eine oder mehrere Stationen. ▶ startet direkt (mehrere Stationen nacheinander), Antippen lädt sie
- **Ablauf:** „+ Station“ hängt die aktuelle Übung an; Ablauf starten oder als Übung speichern
- **Einstellungen:** Ansage, Spracheingabe, Schusserkennung, Konto, Sichern/Import
- **Pass-Skizze** im Training: 5er→3er von oben, angesagtes Ziel (Wall/Lane) als Pfeil hervorgehoben
- Eigene Dialoge statt Browser-Popups; kurze Einführung beim allerersten Start (nicht für bestehende Nutzer)
- Statistik ab 1000 px Breite (iPad quer) zweispaltig

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

### Besser trainieren (v3.7)
- **Lernpfad** (Einstellungen › Trainingshilfen, Standard: an): Karte auf der Trainingsseite für die gewählte Disziplin und Technik. Drei Stufen: **Serie** → **Gemischt** → **Signal**. Eine Stufe gilt als geschafft, wenn die letzten 30 Aktionen auf dieser Stufe (in mindestens 2 Sessions) über der Schwelle liegen: 75 % / 65 % / 55 %. Die Schwellen sind erste Schätzwerte (`LP` in `js/learn.js`) und werden mit echten Daten nachjustiert. „Stufe starten“ stellt die Übung passend ein und beginnt. Der Stand wird aus den Einträgen berechnet, nicht gespeichert. Standardtests und Druckserien zählen nicht mit. Nicht für Kombi
- **Druckmodus** (Anpassen › Druckmodus: Aus / 3 / 5 / 8 / 10): Fehlschuss = Serie zurück auf 0. Ende, sobald die Serie erreicht ist oder der Umfang aufgebraucht. Ein Treffer vor dem Ziel kommt die Ansage „Matchball“ (Anzeige „MATCHBALL“). Die Konfiguration zeigt aus deiner bisherigen Quote, wie viele Versuche eine Serie im Schnitt braucht. Ergebnis (geschafft / beste Serie) in der Auswertung und an der Session (`pr`). Nicht für Kombi
- **Standardtest** (monatlich, Erinnerung abschaltbar): zwei Stationen mit festen Bedingungen: Schuss 3er (Technik Frei, Ziele 1–5, 25×, Wertung einfach) und Pass 5er→3er (Frei, Wall/Lane, 20×). Sessions tragen `cfg.std = 1` (Protokoll-Version). Zählt nur vollständig gespielt, je Monat der letzte Durchlauf. Karte auf der Trainingsseite (ab 30 erfassten Aktionen), Vergleich zum Vormonat in der Auswertung, „Standardtest-Verlauf“ in der Statistik. Änderungen am Protokoll nur mit neuer Versionsnummer
- **Ermüdungskurve** (Statistik): Quote nach Aktionsnummer im Trainingsblock (Pause über 20 Minuten = neuer Block), Gruppen zu je 20 Aktionen, ab 20 Aktionen je Gruppe. Eine Aussage („Quote fällt“ / „wird besser“) erscheint nur, wenn der Unterschied über der Zufallsstreuung liegt (Zwei-Stichproben-z-Test, 90 %); sonst steht dort ausdrücklich „kein klarer Verlauf“. Druckserien sind ausgenommen (enden am Treffer)

### Daneben mit Richtung (optional)
- Einstellungen › „Daneben mit Richtung“ (Standard: aus). Teilt bei Schüssen „Daneben“ in **← links** und **rechts →** (aus Sicht des Schützen); bei Wertung „Genau“ entsprechend in der Fußleiste
- Gespeichert als Feld `md` (`'l'`/`'r'`) am Eintrag, im Konto in `extra`
- Auswertung: Karte „Fehlschüsse: links oder rechts?“ je Ziel mit Hinweis auf auffällige Tendenzen (≥ 70 % einer Seite bei ≥ 5 Fehlschüssen); bei „Genau“ fließt auch das danebengetroffene Segment ein. Korrektur in der Session-Liste, Spalte „Richtung“ im CSV
- Spracheingabe: „links“ / „rechts“
- Grundlage für spätere Schwachstellenanalyse, Technik-Tipps und Trainer-Auswertung (`missSide()` in `training.js`)

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

### Gamification (abschaltbar, Standard: an)
- Einstellungen › Gamification: Hauptschalter, einzeln **XP & Level** und **Challenges**. Aus = App wie bisher
- **XP** werden nie gespeichert, sondern immer aus den Einträgen berechnet (ausgeschlossene Sessions zählen nicht, Formeländerungen gelten rückwirkend):
  - 1 XP pro Aktion; Treffer zusätzlich 2 XP × Schwierigkeit (bestimmtes Segment ×2, Wall/Lane ×1,5, „egal“ ×1, auf Signal zusätzlich ×1,5)
  - ab der 301. Aktion eines Tages nur 25 %; +20 XP je Session mit mindestens 20 Aktionen; XP aus geschafften Challenges
- **Level:** benötigte Gesamt-XP = 100 · (Level − 1)^1,8 (L5: 1.213, L10: 5.220, L20: 20.033). Titel: Einsteiger, Vereinsspieler, Ligaspieler, Turnierspieler, Profi
- **10 Challenges** (`js/gamification.js`, Liste `CHAL`): Warmlaufen, Linke Ecke, Rechte Ecke, Achterkette, Scharfschütze, Unter Druck, Passmaschine, Durchmarsch, Schwachstelle knacken, Eiserner Wille
  - „Starten“ übernimmt die vorkonfigurierte Übung und startet sie; Fortschritt zählt ab diesem Zeitpunkt, auch aus normalen Trainings mit passender Übung
  - Grenzwerte vorläufig, kalibriert an den Daten vom Oktober 2026
  - Stand der Challenges liegt in `kt2_settings` und wird **nicht** zwischen Geräten abgeglichen
- Training: Trefferserie ab 3 in der Kopfzeile (🔥); Auswertung zeigt XP, Level-Aufstieg und Challenge-Fortschritt

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
- Ermüdungskurve und Standardtest-Verlauf
- Kalenderansicht und Session-Liste mit Notizen; einzelne Sessions können aus der Wertung ausgeschlossen werden

### Daten
- **Ohne Konto** liegt alles lokal im Browser (`localStorage`). Die App funktioniert dann wie bisher, sendet nichts und lädt keine externen Bibliotheken
- **Sichern (JSON)**, **Tabelle (CSV)**, **Importieren (zusammenführen)** – Duplikate werden erkannt, so lassen sich Daten zwischen iPad und iPhone übertragen
- **Alle Daten löschen** (mit doppelter Rückfrage; angemeldet zusätzlich mit Rückfrage zum Konto)

### Konto und Sync (optional)
- Karte „Konto & Sicherung“ auf dem Home-Screen
- **Anmeldung per E-Mail-Code** (6 Ziffern, kein Passwort). Der Code wird in der App eingetippt, ein Link würde auf dem iPhone in Safari statt in der Home-Screen-App landen
- **Abgleich** der eigenen Daten zwischen Geräten und als Sicherung im Konto: automatisch nach Änderungen (mit Verzögerung, nie mitten im Training), beim Zurückkehren in die App und per Knopf „Jetzt abgleichen“
- Training bleibt offline möglich, Änderungen werden später hochgeladen
- Beim ersten Anmelden mit vorhandenen Gerätedaten gibt es eine Rückfrage, ob sie ins Konto übernommen werden. Bei Daten eines anderen Kontos auf dem Gerät ebenfalls
- **Abmelden** behält alle Daten auf dem Gerät. **Konto löschen** entfernt E-Mail-Adresse und alle Daten im Konto, die Gerätedaten bleiben

---

## Technik

- Kein Build-Schritt: `index.html` (Oberfläche), `css/app.css`, Vanilla JS in `js/`:
  | Datei | Inhalt |
  |---|---|
  | `ui.js` | Icons, Dialoge (`ask`, `askText`, `info`), Einführung |
  | `core.js` | Konstanten, Disziplinen, Speicher (`localStorage`), Hilfsfunktionen |
  | `sensors.js` | Signaltöne, Sprachansage, Schusserkennung (Ton/Erschütterung), Spracheingabe, Wake Lock |
  | `home.js` | Startseite, Konfiguration, Schwachstellen-Planung |
  | `training.js` | Trainingsablauf, Eingabe, Korrektur, Auswertung nach der Session |
  | `stats.js` | Statistikseite und Diagramme |
  | `gamification.js` | XP, Level, Challenges |
  | `learn.js` | Lernpfad, Druckmodus, Standardtest, Ermüdungskurve |
  | `tools.js` | Testseite, Export/Import, Alle Daten löschen |
  | `cloud.js` | Anmeldung und Cloud-Sync |
  | `main.js` | Start (läuft als letzte Datei) |
- Die Dateien sind klassische Skripte (keine ES-Module) und teilen sich einen globalen Gültigkeitsbereich. Grund: Der Zustand (`S`, `D`, `R`, `SY`) wird an vielen Stellen neu zugewiesen, was zwischen ES-Modulen nicht geht. Die **Ladereihenfolge** steht in `index.html` und ist verbindlich
- Einzige externe Abhängigkeit: `supabase-js` (fest auf Version 2.118.0 gepinnt, mit Prüfsumme/SRI), per jsDelivr **erst nach der Anmeldung** geladen
- Web Audio API (Signaltöne, Schusserkennung), Web Speech API (Ansage, Spracheingabe), DeviceMotion (Erschütterung)
- Hosting: GitHub Pages, Deployment per GitHub Actions bei jedem Push auf `main` (`.github/workflows/deploy.yml`)
- **Service Worker** (`sw.js`, registriert als `sw.js?v=<Version>`): Seite erst aus dem Netz (max. 3 s, am Browser-Cache vorbei), sonst aus dem Cache; CSS/JS aus dem Cache. Neue Version → neuer Service Worker → App lädt neu, außer mitten im Training (dann danach). **Neue JS-Dateien auch in `FILES` in `sw.js` eintragen**

### Datenspeicher

| Schlüssel | Inhalt |
|---|---|
| `kt2_data` | `{ v: 2, sessions: [...], shots: [...] }` – alle Sessions und Einzelaktionen |
| `kt2_settings` | Konfiguration, Trainingsplan, Optionen (Sprache, Erkennung, Empfindlichkeit) |
| `kt2_sync` | Sync-Stand: Konto-ID, letzter Abgleich, Prüfsummen der abgeglichenen Zeilen, vorgemerkte Löschungen |
| `sb-…-auth-token` | Anmeldung (von supabase-js verwaltet) |

Ältere Daten (Schema v1) werden beim Start automatisch auf v2 migriert.

### Sync-Regeln
- Abgleich = erst holen, dann hochladen. Geändert wird nur, was sich seit dem letzten Abgleich verändert hat (Vergleich über Prüfsummen)
- Wurde dieselbe Zeile auf mehreren Geräten geändert, gewinnt das Gerät, das zuletzt abgleicht
- Gelöscht wird nur, was ausdrücklich gelöscht wurde (Session löschen, Eintrag löschen, „Alle Daten löschen“). Gehen lokale Daten verloren, kommen sie aus dem Konto zurück, das Konto wird nie dadurch geleert
- Löschungen werden **nicht** auf andere Geräte übertragen
- Felder, die die Datenbank nicht kennt, landen verlustfrei in der Spalte `extra`

### Altbestand im Repo

Der Ordner `legacy/` enthält eine frühere Version. Er wird von der App **nicht** geladen.

---

## Backend (Supabase)

- Datenbank, Anmeldung und Zugriffsregeln laufen auf Supabase. Projekt-URL und der **öffentliche** (publishable) Schlüssel stehen in `js/cloud.js` (`SB_URL`, `SB_KEY`)
- Den geheimen Schlüssel (`service_role` / secret) und das Datenbank-Passwort **nie** ins Repo schreiben
- Der Schutz der Daten liegt in den Zugriffsregeln (Row Level Security): Jeder sieht und ändert nur eigene Zeilen, nicht angemeldete Besucher haben keinen Zugriff
- Das Schema liegt als Migrationen in `supabase/migrations/`. Die GitHub-Integration von Supabase spielt neue Migrationen beim Merge nach `main` ein
- Tabellen: `profiles`, `sessions`, `shots`. Konto löschen läuft über die Funktion `delete_my_account()`
- Neue Version der Bibliothek: in `js/cloud.js` Version und Prüfsumme (`SB_LIB`, `SB_SRI`) gemeinsam ändern

### Einrichtung in Supabase
1. Authentication › Templates: Vorlagen **Magic Link** und **Confirm signup** so ändern, dass sie `{{ .Token }}` enthalten (Code statt Link)
2. Authentication › URL Configuration: die URL der gehosteten App als Site-URL eintragen
3. Integrations › GitHub: Arbeitsverzeichnis `.`, Production-Branch `main`

### Datenschutz
- Gespeichert werden E-Mail-Adresse, Sessions und Einträge, nichts davon wird ohne Anmeldung übertragen
- Vor dem Einladen anderer Nutzer fehlen noch: Datenschutzerklärung, vermutlich Impressum, Auftragsverarbeitungsvertrag mit Supabase und die Prüfung der Projekt-Region

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
- Version und Datum stehen **nur** in `index.html` (`window.KT_VER`). Sie werden als `?v=…` an CSS und alle Skripte gehängt, damit iOS nach einem Update keine alten und neuen Dateien mischt
- Bei jeder Änderung hochzählen und das Badge in dieser README anpassen
- Schema: Patch (`3.1.x`) für Fixes, Minor (`3.x.0`) für neue Funktionen, Major für Datenmodell-Änderungen

### Arbeitsweise
- Änderungen auf einem Feature-Branch, Merge nach `main` erst nach Test auf dem Gerät
- Ein Push auf `main` deployt sofort live

---

## Bekannte Einschränkungen

- Offline: Die App startet ohne Netz aus dem Cache des Service Workers. Anmeldung und Abgleich brauchen Netz
- Ohne Konto sind Daten an Browser und Gerät gebunden; ohne regelmäßiges Sichern (JSON) gehen sie bei gelöschten Website-Daten verloren
- Mit Konto werden Löschungen nicht auf andere Geräte übertragen, und bei Konflikten gewinnt das zuletzt abgleichende Gerät
- Der Sync-Stand liegt ebenfalls im Browser-Speicher (bei sehr vielen Einträgen wächst er mit)
- Spracheingabe ist Beta und browserabhängig
- Erschütterungserkennung setzt voraus, dass das iPad direkt auf dem Tisch liegt

## Roadmap

- Rangliste (freiwillig, nur zusammengefasste Werte, Server-Funktion) und Challenge-Stand im Konto speichern
- Gruppen mit Einladungscode und gemeinsame Challenges (gleiche Konfiguration, Rangliste je Challenge)
- Gespielte Partien erfassen (beide Seiten bestätigen) und daraus eine Elo-Rangliste berechnen (serverseitig)
- Löschungen zwischen Geräten übertragen
