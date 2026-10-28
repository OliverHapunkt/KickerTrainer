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
```

| Datei | Inhalt |
|---|---|
| `spiel-erfassen.test.js` | Nickname, Gäste, Aufstellung, Zählen, Eigentor, Tausch, Satz- und Spielende, Auswertung, Offline-Warteschlange, Abbruch |
| `lobby-beitritt.test.js` | Lobby und Beitritt per Code aus **beiden** Blickwinkeln: Host öffnet, Mitspieler tritt bei, Zuordnung, Starten, Verlassen, Abbrechen |
| `bestaetigung.test.js` | Der ganze Weg: Host zählt, Mitspieler widerspricht, Host korrigiert, Mitspieler bestätigt. Dazu der abgelaufene Korrekturzeitraum und ein Spiel aus Host und Gästen, das sofort zählt |
| `rechtliches.test.js` | Impressum und Datenschutz: Darstellung, Querverlinkung, Verlinkung aus der App, und dass die Pflichtangaben wirklich drinstehen und keine echten Kontaktdaten versehentlich veröffentlicht werden |
| `erkennung.test.js` | Erkennungslogik (`detector.js`) mit künstlichen Signalen: Knall, Abschlag+Einschlag, leiser Schuss, lauter Raum, Sprechen, Dauerrauschen, Ruck, Rechnung der Kalibrierung. Gibt die bekannten Grenzen (abruptes lautes Sprechen) als „Grenze“ aus |
| `kalibrierung.test.js` | Kalibrierung im Browser mit Fake-Mikrofon und künstlichen Signalen: Ablauf, Schwellen, automatische Wahl der Erkennung, Auto-Treffer im Training, Gegenproben (Sprechen ohne Ruck, Ruck ohne Ton), Zurücksetzen, Abbruch, Zeitüberschreitung |
| `fake-supabase.js` | Ersatz für supabase-js. Bildet nur die Aufrufe nach, die die App macht, und spiegelt die Spiellogik aus `record_goal`/`undo_goal`/`settle_match` |

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
- Nach „Ergebnis korrigieren" stand das Spiel auf „läuft", hatte aber keinen laufenden Satz: Der Zählbildschirm zeigte „Satz null" und 0:0, und das nächste Tor lief auf einen Fehler
