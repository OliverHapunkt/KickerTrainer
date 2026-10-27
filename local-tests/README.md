# Browsertests

Gehören **nicht** zum Deployment, sind nur Werkzeug für die Entwicklung. Sie
starten ein echtes Chromium, laden die App und bedienen sie wie ein Mensch.

Auf dem iPad geht das nicht. Der Nutzen liegt darin, dass bei jeder Änderung
nachgeprüft werden kann, ob der Ablauf noch funktioniert, bevor etwas live geht.

## Ausführen

```bash
npm i playwright && npx playwright install chromium
node local-tests/spiel-erfassen.test.js
```

| Datei | Inhalt |
|---|---|
| `spiel-erfassen.test.js` | Nickname, Gäste, Aufstellung, Zählen, Eigentor, Tausch, Satz- und Spielende, Auswertung, Offline-Warteschlange, Abbruch |
| `fake-supabase.js` | Ersatz für supabase-js. Bildet nur die Aufrufe nach, die die App macht, und spiegelt die Spiellogik aus `record_goal`/`undo_goal` |

## Grenzen

- **Kein echtes Supabase.** Die Serverlogik selbst ist mit SQL-Tests geprüft, siehe `supabase/local-tests/`
- Chromium, nicht iOS Safari. Textbreiten und Eingabeverhalten können dort abweichen
- Geprüft wird der Ablauf, nicht wie es aussieht

## Fehler, die diese Tests gefunden haben

- Die Tab-Leiste war beim ersten Start komplett leer, weil `renderGam()` ein Tab direkt im DOM versteckt hat
- „Einstellungen" wurde in der fünfteiligen Tab-Leiste abgeschnitten
- Der Spiel-Bildschirm zeigte „Konto nötig", obwohl man angemeldet war – er wurde gebaut, bevor die Sitzung geladen war
- Beim schnellen Tippen konnte eine ältere Serverantwort den neueren Stand überschreiben, der Zähler sprang zurück
