# Lokale Prüfung der Zugriffsregeln

Diese Dateien gehören **nicht** zum Deployment. Supabase spielt nur
`supabase/migrations/` ein; dieser Ordner wird dabei ignoriert.

Sie prüfen gegen ein lokales Postgres, dass die Migrationen sauber laufen und die
Zugriffsregeln (Row Level Security) wirklich das tun, was sie sollen – vor allem,
dass niemand Daten sieht oder ändert, die ihm nicht gehören.

## Ausführen

Braucht ein lokales Postgres (ab 15). Auf dem iPad geht das nicht; das ist ein
Werkzeug für die Entwicklung, nicht für den Betrieb.

```bash
initdb -D /tmp/kt/data -U postgres --auth=trust
pg_ctl -D /tmp/kt/data -o "-k /tmp/kt/sock -c listen_addresses=''" start
createdb -h /tmp/kt/sock -U postgres kt

psql -h /tmp/kt/sock -U postgres -d kt -v ON_ERROR_STOP=1 -f 00_harness.sql
for f in ../migrations/*.sql; do
  psql -h /tmp/kt/sock -U postgres -d kt -v ON_ERROR_STOP=1 -f "$f" || break
done
psql -h /tmp/kt/sock -U postgres -d kt -f 10_test_rls.sql
```

Am Ende steht je Prüfung `PASS` oder `FAIL`.

## Was die Dateien tun

| Datei | Inhalt |
|---|---|
| `00_harness.sql` | Minimaler Ersatz für das, was Supabase mitbringt: die Rollen `anon` und `authenticated`, das Schema `auth` mit `auth.users` und `auth.uid()`, und die Standardrechte auf neue Tabellen |
| `10_test_rls.sql` | 81 Prüfungen: Spielerprofile, Sichtbarkeit, Gruppen und Rollen, Spielablauf, Bestätigung und Korrektur, kein Zugriff ohne Anmeldung, Kontolöschung |
| `20_test_matches.sql` | 43 Prüfungen der Spiel-Funktionen: Aufstellung prüfen, Tore zählen, Eigentor, Satz- und Spielende, Rückgängig über das Satzende hinweg, einfache Erfassung ohne Tor-Zeilen |
| `30_test_lobby.sql` | 49 Prüfungen zu Lobby und Beitritt: Code, Teamverteilung, volle Lobby, Starten erst bei vollständiger Aufstellung, Verlassen, Entfernen durch den Host |
| `40_test_bestaetigung.sql` | 57 Prüfungen zu Bestätigung und Korrektur: automatische Bestätigung bei Host und Gästen, Zustimmung der Gegenseite, Widerspruch, Wiederaufnahme innerhalb von 2 Stunden samt Verfall der alten Bestätigungen, abgelaufene Korrekturzeit, Sichtbarkeit |
| `50_test_bilanz.sql` | 47 Prüfungen: Gastnamen je Besitzer und je Gruppe eindeutig, Gast darf wie ein Konto heißen, Längen, Kategorie bei Spiel und Lobby (auch alter Aufruf ohne Kategorie), `my_match_history()` – Inhalt, Sicht aus dem eigenen Team, keine user_id, nur eigene Spiele, ohne Anmeldung gesperrt |
| `60_test_elo.sql` | 76 Prüfungen: Werte nachgerechnet (1024/976, Erwartung im 2. Spiel), locker zählt nicht und Umstellen rechnet neu, Korrektur nimmt die Wertung zurück, Doppel und Paarungen getrennt, erst nach Bestätigung durch die Gegenseite, Sichtbarkeit, kein Schreiben und kein Neurechnen vom Client, `my_ratings`, Elo im Spielverlauf, K = 24 ab 10 Spielen, Rangliste mit Zustimmung/Widerruf, Konto löschen lässt die anderen unverändert |
| `80_test_offline.sql` | 36 Prüfungen zu Offline-Spielen: `create_match` mit Nummer vom Gerät, `import_match` – Stand nach dem Einspielen, Host plus Gast sofort bestätigt, Zeiten vom Gerät (begrenzt auf 60 Tage und nicht in der Zukunft), zweiter Upload ohne Doppel, fremde Nummer und fremde Gäste abgewiesen, unstimmige Daten ohne halbes Spiel, halbes Spiel läuft online weiter (Regeln, Schützen, Eigentor, Rückgängig), online angelegtes leeres Spiel bekommt die Tore |

Ein Hinweis zur Testform: Wer beitreten will, darf das Spiel vorher **nicht** sehen
dürfen. Der Beitrittscode wird in den Tests deshalb als Superuser in einer
Hilfstabelle abgelegt – die Testnutzer können ihn nicht selbst aus `matches` lesen.
Genau das ist gewollt.

Die Browsertests der Oberfläche liegen getrennt davon in `local-tests/` im Wurzelverzeichnis.

## Grenzen

- **Das ist nicht Supabase.** Das Gerüst bildet nur nach, was die Migrationen
  brauchen. Eigenheiten der echten Umgebung (PostgREST, JWT-Details, die genauen
  Standardrechte) sind nicht abgedeckt
- Lokal läuft Postgres 16, Supabase 17. Für dieses Schema spielt das keine Rolle,
  es bleibt aber ein Unterschied
- Geprüft wird das Datenmodell, nicht die Oberfläche

## Zwei Fallen, die diese Tests gefunden haben

Beide würden im Betrieb erst beim Client auffallen, nicht beim Einspielen:

1. **Eine Funktion als Spalten-Default läuft mit den Rechten des Einfügenden.**
   `gen_code()` war zunächst für `authenticated` gesperrt – damit schlug jedes
   Anlegen einer Gruppe oder eines Spiels fehl.

2. **Eine SELECT-Regel, die ihre eigene Tabelle abfragt, sieht die gerade
   eingefügte Zeile nicht.** Dadurch scheitert jedes `insert ... returning`, also
   jedes `insert().select()` von supabase-js. Die Regeln für `players` und
   `matches` prüfen deshalb die Spalten der Zeile direkt. Bei `groups` ging das
   nicht (die Berechtigung hängt an der Mitgliedschaft, die es beim Einfügen noch
   nicht gibt) – darum legt `create_group()` Gruppe und Owner zusammen an.
