// Tests der Server-Funktion code-login (supabase/functions/code-login/handler.ts)
// ohne Netz: Supabase wird durch eine kleine Attrappe ersetzt.
// Ausführen: node local-tests/code-login.test.js   (Node ≥ 22.18, liest TypeScript direkt)
'use strict';
const path = require('path');
let ok = 0, bad = 0;
const t = (name, cond) => { if (cond) ok++; else { bad++; console.log('FEHLER:', name); } };

function fakeSupabase() {
  const db = { players: [], sessions: [] };
  const users = new Map(); // id -> {id,email,password,created_at}
  const sessions = new Map(); // token -> uid
  let n = 0, clock = Date.parse('2026-11-28T10:00:00Z');
  const mkSession = (uid) => { const tok = 'tok' + (++n); sessions.set(tok, uid); return { access_token: tok, refresh_token: 'ref' + n }; };
  const userOf = (tok) => { const u = users.get(sessions.get(tok)); return u ? { data: { user: { ...u } }, error: null } : { data: { user: null }, error: { message: 'bad jwt' } }; };
  function from(table) {
    const rows = db[table], f = [];
    let lim = Infinity;
    const q = {
      select() { return q; },
      eq(c, v) { f.push(r => r[c] === v); return q; },
      is(c, v) { f.push(r => (r[c] ?? null) === v); return q; },
      ilike(c, pat) { const s = pat.replace(/\\(.)/g, '$1').toLowerCase(); f.push(r => String(r[c]).toLowerCase() === s); return q; },
      limit(k) { lim = k; return q; },
      then(res) { res({ data: rows.filter(r => f.every(x => x(r))).slice(0, lim), error: null }); },
      insert(row) {
        if (table === 'players' && row.kind === 'account' && rows.some(r => r.kind === 'account' && !r.deleted_at && r.nickname.toLowerCase() === row.nickname.toLowerCase()))
          return Promise.resolve({ error: { code: '23505', message: 'dup' } });
        rows.push({ id: 'p' + (++n), deleted_at: null, ...row });
        return Promise.resolve({ error: null });
      },
    };
    return q;
  }
  const admin = {
    from,
    auth: {
      getUser: async (tok) => userOf(tok),
      admin: {
        createUser: async ({ email, password }) => {
          const id = 'u' + (++n); users.set(id, { id, email, password, created_at: new Date(clock).toISOString() });
          return { data: { user: { id, email } }, error: null };
        },
        deleteUser: async (id) => { users.delete(id); db.players.forEach(p => { if (p.user_id === id) p.user_id = null; }); return { error: null }; },
        getUserById: async (id) => users.has(id) ? { data: { user: { ...users.get(id) } }, error: null } : { data: null, error: { message: 'nf' } },
        updateUserById: async (id, o) => { Object.assign(users.get(id), o.password ? { password: o.password } : {}, o.email ? { email: o.email } : {}); return { error: null }; },
      },
    },
  };
  const anon = () => ({ auth: { signInWithPassword: async ({ email, password }) => {
    const u = [...users.values()].find(x => x.email === email && x.password === password);
    return u ? { data: { session: mkSession(u.id) }, error: null } : { data: { session: null }, error: { message: 'Invalid login credentials' } };
  } } });
  // E-Mail-Konto, wie es signInWithOtp + verifyOtp anlegen würde
  const otpUser = (email, ageMin = 1) => { const id = 'u' + (++n); users.set(id, { id, email, created_at: new Date(clock - ageMin * 60000).toISOString() }); return mkSession(id).access_token; };
  let seed = 7;
  const rand = (k) => { const a = new Uint8Array(k); for (let i = 0; i < k; i++) { seed = (seed * 1103515245 + 12345) >>> 0; a[i] = seed >>> 24; } return a; };
  return { db, users, deps: { admin, anon, rand, uuid: () => 'uuid' + (++n), now: () => clock }, otpUser };
}

(async () => {
  const h = await import(path.join(__dirname, '../supabase/functions/code-login/handler.ts'));
  const call = async (F, body, tok) => {
    const r = await h.handle(new Request('https://x/', { method: 'POST', headers: tok ? { authorization: 'Bearer ' + tok } : {}, body: JSON.stringify(body) }), F.deps);
    return { status: r.status, body: await r.json() };
  };

  // Code-Erzeugung
  const F0 = fakeSupabase();
  const codes = new Set();
  for (let i = 0; i < 300; i++) { const c = h.newCode(F0.deps.rand); codes.add(c); t('Code Länge/Zeichen ' + c, c.length === 12 && [...c].every(ch => h.ALPHA.includes(ch))); }
  t('Codes verschieden', codes.size === 300);
  t('Code ohne 0 O 1 I L', ![...codes].join('').match(/[0O1IL]/));
  t('normCode', h.normCode(' k7p-m2x 9qf-h4t ') === 'K7PM2X9QFH4T');
  t('likeExact maskiert', h.likeExact('a_b%c') === 'a\\_b\\%c');

  // Registrieren
  const F = fakeSupabase();
  let r = await call(F, { action: 'signup', nick: '  Max   Muster ' });
  t('signup 200', r.status === 200);
  t('signup Code + Sitzung', r.body.code && r.body.code.length === 12 && r.body.session && r.body.session.access_token);
  const code = r.body.code, tokA = r.body.session.access_token;
  const pl = F.db.players.find(p => p.nickname === 'Max Muster');
  t('Spielerzeile angelegt (Leerzeichen bereinigt)', pl && pl.kind === 'account' && pl.user_id);
  const ua = F.users.get(pl.user_id);
  t('Platzhalter-Adresse', h.isCodeMail(ua.email));
  t('Antwort verrät die Adresse nicht', !JSON.stringify(r.body).includes(h.DOMAIN));
  r = await call(F, { action: 'signup', nick: 'max muster' });
  t('Nickname vergeben (Groß/klein egal)', r.status === 409 && r.body.error === 'nick_taken');
  r = await call(F, { action: 'signup', nick: 'ab' });
  t('Nickname zu kurz', r.status === 400 && r.body.error === 'nick_len');
  r = await call(F, { action: 'signup', nick: 'x'.repeat(21) });
  t('Nickname zu lang', r.status === 400);
  t('kein verwaistes Konto bei Fehlern', F.users.size === 1);

  // Anmelden
  r = await call(F, { action: 'login', nick: 'MAX MUSTER', code: code.slice(0, 4) + '-' + code.slice(4, 8).toLowerCase() + ' ' + code.slice(8) });
  t('login mit Bindestrichen/Kleinschreibung', r.status === 200 && r.body.session.access_token);
  r = await call(F, { action: 'login', nick: 'Max Muster', code: 'AAAAAAAAAAAA' });
  t('falscher Code', r.status === 401 && r.body.error === 'login_failed');
  r = await call(F, { action: 'login', nick: 'Niemand', code });
  t('unbekannter Nickname gleiche Meldung', r.status === 401 && r.body.error === 'login_failed');
  r = await call(F, { action: 'login', nick: 'Max_Muster', code });
  t('Platzhalter im Nickname wirkt nicht', r.status === 401);

  // Neuer Code
  r = await call(F, { action: 'regen' });
  t('regen ohne Anmeldung', r.status === 401);
  r = await call(F, { action: 'regen' }, tokA);
  t('regen ok', r.status === 200 && r.body.code && r.body.code !== code);
  const code2 = r.body.code;
  t('alter Code ungültig', (await call(F, { action: 'login', nick: 'Max Muster', code })).status === 401);
  t('neuer Code gültig', (await call(F, { action: 'login', nick: 'Max Muster', code: code2 })).status === 200);
  const tokNoPlayer = F.otpUser('ohne@nick.de');
  t('regen ohne Nickname abgelehnt', (await call(F, { action: 'regen' }, tokNoPlayer)).body.error === 'no_player');

  // E-Mail verknüpfen
  r = await call(F, { action: 'link', email_token: 'x' });
  t('link ohne Anmeldung', r.status === 401);
  const tokB = F.otpUser('max@beispiel.de');
  const nBefore = F.users.size;
  r = await call(F, { action: 'link', email_token: tokB }, tokA);
  t('link ok', r.status === 200 && r.body.email === 'max@beispiel.de');
  t('E-Mail jetzt am Code-Konto', F.users.get(pl.user_id).email === 'max@beispiel.de');
  t('leeres Hilfskonto gelöscht', F.users.size === nBefore - 1);
  t('Code-Anmeldung geht weiter', (await call(F, { action: 'login', nick: 'Max Muster', code: code2 })).status === 200);
  r = await call(F, { action: 'link', email_token: F.otpUser('zwei@beispiel.de') }, tokA);
  t('zweites Verknüpfen abgelehnt', r.status === 409 && r.body.error === 'has_email');

  // Fremdes, bestehendes Konto darf nicht aufgelöst werden
  r = await call(F, { action: 'signup', nick: 'Lisa' });
  const tokL = r.body.session.access_token;
  const tokOld = F.otpUser('alt@beispiel.de', 120); // vor 2 h angelegt
  r = await call(F, { action: 'link', email_token: tokOld }, tokL);
  t('älteres Konto: email_taken', r.status === 409 && r.body.error === 'email_taken');
  const tokData = F.otpUser('daten@beispiel.de');
  const uidData = [...F.users.values()].find(u => u.email === 'daten@beispiel.de').id;
  F.db.sessions.push({ id: 's1', user_id: uidData });
  r = await call(F, { action: 'link', email_token: tokData }, tokL);
  t('Konto mit Daten: email_taken', r.status === 409 && F.users.has(uidData));
  r = await call(F, { action: 'link', email_token: tokL }, tokL);
  t('sich selbst verknüpfen abgelehnt', r.status === 400);

  // Sonstiges
  const o = await h.handle(new Request('https://x/', { method: 'OPTIONS' }), F.deps);
  t('CORS-Vorabfrage', o.status === 200 && o.headers.get('access-control-allow-origin') === '*');
  t('unbekannte Aktion', (await call(F, { action: 'boom' })).status === 400);

  console.log((bad ? '✗' : '✓') + ' code-login: ' + ok + ' ok, ' + bad + ' Fehler');
  process.exit(bad ? 1 : 0);
})();
