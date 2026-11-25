#!/usr/bin/env python3
"""Prüft alle Migrationen auf DELETE/UPDATE ohne WHERE.

Supabase lädt für Anfragen über die API die Erweiterung pg_safeupdate. Sie
bricht jedes DELETE und UPDATE ohne WHERE ab – auch innerhalb von Funktionen
und Triggern. Das lokale Postgres hat sie nicht, die SQL-Tests sehen den Fehler
also nicht. Diese Prüfung schon. Gefunden nach v3.20.0: recompute_ratings()
leerte die Elo-Tabellen mit `delete from …;` und jede Bestätigung scheiterte.

Abhilfe im Code: `where true` (die Erweiterung prüft nur, ob es eine Bedingung gibt).
Ausnahme: Anweisungen, die nur beim Einspielen laufen (nicht in einem $$-Block),
laufen als Migrationsrolle ohne die Erweiterung – die werden nur gemeldet, nicht beanstandet.
"""
import re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent / 'migrations'
bad = 0
latest = {}
for f in sorted(root.glob('*.sql')):
    src = f.read_text()
    # Kommentare entfernen
    src = re.sub(r'--[^\n]*', '', src)
    # $$-Blöcke (Funktionsrümpfe) markieren
    parts = re.split(r'(\$[a-z_]*\$)', src)
    inside, tag, chunks = False, None, []
    for p in parts:
        if re.fullmatch(r'\$[a-z_]*\$', p):
            if not inside: inside, tag = True, p
            elif p == tag: inside, tag = False, None
            continue
        chunks.append((inside, p))
    # Funktionsname aus dem Text vor dem Rumpf; spätere Fassung ersetzt frühere
    last = ''
    for in_fn, text in chunks:
        if not in_fn: last = text; continue
        names = re.findall(r'function\s+(?:public\.)?([a-z_]+)\s*\(', last)
        latest[names[-1] if names else f.name + ':' + str(len(latest))] = (f.name, text)
for name, (fname, text) in latest.items():
    for stmt in text.split(';'):
        s = ' '.join(stmt.split()).lower()
        m = re.search(r'\b(delete\s+from|update)\s+(public\.)?[a-z_]+\b', s)
        if not m: continue
        rest = s[m.start():]
        if ' where ' not in rest + ' ':
            bad += 1
            print('FAIL  %s (%s): %s' % (name, fname, rest[:90]))
print('PASS  Kein DELETE/UPDATE ohne WHERE in Funktionen' if not bad else '%d Anweisung(en) ohne WHERE' % bad)
sys.exit(1 if bad else 0)
