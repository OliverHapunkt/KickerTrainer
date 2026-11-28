# Browsertests

Gehören **nicht** zum Deployment, sind nur Werkzeug für die Entwicklung. Sie
starten ein echtes Chromium, laden die App und bedienen sie wie ein Mensch.

Auf dem iPad geht das nicht. Der Nutzen liegt darin, dass bei jeder Änderung
nachgeprüft werden kann, ob der Ablauf noch funktioniert, bevor etwas live geht.

## Ausführen

```bash
npm i playwright && npx playwright install chromium
node local-tests/spiel-erfassen.test.js
node local-tests/lobby-beitritt.test.js
node local-tests/rechtliches.test.js
node local-tests/bestaetigung.test.js
node local-tests/erkennung.test.js      # kein Browser nötig
node local-tests/kalibrierung.test.js
node local-tests/simple-modus.test.js
node local-tests/reaktion.test.js            # kein Browser nötig
node local-tests/reaktionsschiessen.test.js
node local-tests/kamera-labor.test.js
node local-tests/bilanz.test.js             # kein Browser nötig
node local-tests/bilanz-browser.test.js
node local-tests/elo.test.js
node local-tests/regeln.test.js             # kein Browser nötig
node local-tests/regeln-browser.test.js
node local-tests/code-login.test.js         # kein Browser nötig (Node ≥ 22.18)
node local-tests/konto-code-browser.test.js
node local-tests/code-login.test.js         # kein Browser nötig (Node ≥ 22.18)
node local-tests/konto-code-browser.test.js
```

| Datei | Inhalt |
|---|---|
| `spiel-erfassen.test.js` | Nickname, Gäste, Aufstellung, Zählen, Eigentor, Tausch, Satz- und Spielende, Auswertung, Offline-Warteschlange, Abbruch |
| `lobby-beitritt.test.js` | Lobby und Beitritt per Code aus **beiden** Blickwinkeln: Host öffnet, Mitspieler tritt bei, Zuordnung, Starten, Verlassen, Abbrechen |
| `bestaetigung.test.js` | Der ganze Weg: Host zählt, Mitspieler widerspricht, Host korrigiert, Mitspieler bestätigt. Dazu der abgelaufene Korrekturzeitraum und ein Spiel aus Host und Gästen, das sofort zählt |
| `rechtliches.test.js` | Impressum und Datenschutz: Darstellung, Querverlinkung, Verlinkung aus der App, und dass die Pflichtangaben wirklich drinstehen und keine echten Kontaktdaten versehentlich veröffentlicht werden |
| `erkennung.test.js` | Erkennungslogik (`detector.js`) mit künstlichen Signalen: Knall, Abschlag+Einschlag, leiser Schuss, lauter Raum, Sprechen, Dauerrauschen, Ruck, Rechnung der Kalibrierung. Gibt die bekannten Grenzen (abruptes lautes Sprechen) als „Grenze“ aus |
| `kalibrierung.test.js` | Kalibrierung im Browser mit Fake-Mikrofon und künstlichen Signalen: Ablauf, Schwellen, automatische Wahl der Erkennung, Auto-Treffer im Training, Gegenproben (Sprechen ohne Ruck, Ruck ohne Ton), Zurücksetzen, Abbruch, Zeitüberschreitung |
| `simple-modus.test.js` | Simple-/Profi-Modus: Voreinstellungen frischer Installationen, bestehende Nutzer bleiben bei Profi, nur Schuss 3er/Pass 5er und 10/20/50, keine Technik, feste Übung, Aufklappen über die Kopfzeile, Start mit der Simple-Übung, dazu die Regler (Bereiche, Anzeige, Übernahme, kein Neuzeichnen beim Ziehen) |
| `reaktion.test.js` | Rechenlogik Reaktionsschießen ohne Browser: Stufen, Rhythmen wiederholen sich, Chaos, immer nur ein Grün, Ablenkfarben nie auf Grün, Wartezeit aufs Ziel, Beurteilung mit/ohne Ansage, Signal-Fenster, Individuell (Median der letzten 20), Dynamisch |
| `reaktionsschiessen.test.js` | Reaktionsschießen im Browser mit Fake-Mikrofon: Konfiguration, Hilfe-Dialog samt „nicht mehr anzeigen“, ein Grün, Bernstein-Rahmen, Ablenkfarben, zu früh/spät/verpasst, ohne Ansage, Signal mit Piep und Aufleuchten (schneller Schuss wird nicht verschluckt), Signal ohne Erkennung gesperrt, Individuell, Dynamisch, ohne Erkennung |
| `kamera-labor.test.js` | Kamera-Probe: Auswertung mit künstlichen Bildfolgen (Streifen 1–5, 30/60 fps, Wackeln, unsicher, kein Ball), dazu im Browser mit dem Fake-Video von Chromium: Freischalten per 7× Tippen, Kamera, Bildrate, Schuss, Wahrheit eintragen, Text zum Kopieren, Ausschnitt-Regler, Abschalten |
| `bilanz.test.js` | Rechenlogik der Bilanz ohne Browser: Sieg aus meiner Sicht (Team 1 und 2), Filter Zeitraum/Modus/Art, strittige zählen nicht, Serien, Form, zwei Franks als zwei Gegner, Partner, Paare, Monate, eigene Tore |
| `bilanz-browser.test.js` | Zwei Konten legen je einen Gast „Frank“ an, doppelter Gast beim selben Host, Kürzel, Art Wertung/locker beim Anlegen und in der Lobby, Bilanz-Tab mit Übersicht, Gegnern, Filtern, Direktvergleich, offline aus dem Zwischenspeicher |
| `elo.test.js` | Elo im Browser: +24 → 1024 in der Auswertung, lockeres Spiel ohne Elo, Wertungskarte mit Kurve und „vorläufig“, Elo je Begegnung und Gegner-Elo, Rangliste mit Zustimmungsdialog (Abbrechen ändert nichts), Aufnahme ab 10 Spielen, Gast nie, Widerruf, Korrektur rechnet neu |
| `code-login.test.js` | Server-Funktion `code-login` ohne Netz: Code-Format (12 Zeichen, keine verwechselbaren), Registrieren, vergebener/zu kurzer Nickname, kein verwaistes Konto, Anmelden (Bindestriche, Kleinschreibung, gleiche Meldung bei falschem Code und unbekanntem Nickname), neuer Code macht alten ungültig, E-Mail nachtragen nur mit frischem leeren Konto, Platzhalter-Adresse nie in der Antwort |
| `konto-code-browser.test.js` | Web-App-Hinweis (erster Aufruf, iPhone-Anleitung zuerst, nicht in der installierten App, unter Hilfe), Konto mit Code: Altershinweis, Eltern-Haken, Code-Dialog nur mit „gesichert“ schließbar, Anzeige ohne Platzhalter-Adresse, neuer Code, Ab- und Anmelden, E-Mail hinzufügen |
| `offline-spiele.test.js` | Ohne Netz drei Spiele anlegen und zählen (Rückgängig, Regeln gesperrt, Auswertung „noch auf diesem Gerät“, letztes Tor zurücknehmen), Neustart der App, Fortsetzen, Netz zurück: genau drei Uploads, Gast-Spiele bestätigt, offenes Spiel läuft über den Server weiter, abgelehntes Spiel mit „Verwerfen“, Tipps anderer Spiele gehen nicht verloren, Rückgängig ohne Netz, Rückfall bei Netzfehler trotz „online“, Warnung beim Abmelden |
| `selbst-zaehlen.test.js` | Jeder zählt am eigenen Handy, vier Konten: Zählweise in der Lobby (Team-Handy neben eigenem Handy abgewiesen), Kennzeichen beim Host, Zählansicht mit großem Stand (eigenes Team links) und Tor-Knopf, Doppeltipp zählt einmal, Rückgängig, Querformat (Stand links, Knopf rechts), „Ich gehe hinten“, Eigentor vom Gegner, Rechte (kein Tor für Gegner, nicht für den Partner, fremdes Tor nicht zurücknehmen), ohne Netz gesperrt, Host-Anzeige aktualisiert sich, nach Spielende zur Bestätigung |
| `fake-supabase.js` | Ersatz für supabase-js. Bildet nur die Aufrufe nach, die die App macht, und spiegelt die Spiellogik aus `record_goal`/`undo_goal`/`settle_match` und die Elo-Rechnung aus `recompute_ratings` |

## Grenzen

- **Erkennungstests nutzen künstliche Signale.** Wie ein echter Tisch klingt, zeigt nur die Kalibrierung am Gerät. Bewegungssensor ist in Chromium ein Ersatz (`DeviceMotionEvent`-Stub)
- Querformat-Layout nur in Chromium geprüft, ohne echte Safe-Area-Ränder und ohne iOS Safari
- **Kein echtes Supabase.** Die Serverlogik selbst ist mit SQL-Tests geprüft, siehe `supabase/local-tests/`
- Chromium, nicht iOS Safari. Textbreiten und Eingabeverhalten können dort abweichen
- Geprüft wird der Ablauf, nicht wie es aussieht

## Fehler, die diese Tests gefunden haben

- Die Tab-Leiste war beim ersten Start komplett leer, weil `renderGam()` ein Tab direkt im DOM versteckt hat
- „Einstellungen" wurde in der fünfteiligen Tab-Leiste abgeschnitten
- Der Spiel-Bildschirm zeigte „Konto nötig", obwohl man angemeldet war – er wurde gebaut, bevor die Sitzung geladen war
- Nach einem Kontowechsel stand kurz der Nickname der vorherigen Person auf dem Bildschirm
- Beim schnellen Tippen konnte eine ältere Serverantwort den neueren Stand überschreiben, der Zähler sprang zurück
- Beim Öffnen eines anderen Spiels gingen noch nicht gesendete Tipps des vorherigen verloren; „Rückgängig“ ohne Netz ließ den Stand stehen
- Nach „Ergebnis korrigieren" stand das Spiel auf „läuft", hatte aber keinen laufenden Satz: Der Zählbildschirm zeigte „Satz null" und 0:0, und das nächste Tor lief auf einen Fehler
