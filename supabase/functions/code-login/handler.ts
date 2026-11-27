// KickerTrainer · Anmeldung mit Nickname + Code (ohne E-Mail)
//
// Ein Code-Konto ist ein normales Supabase-Konto mit einer Platzhalter-Adresse
// (<uuid>@code.kickertrainer.invalid, bekommt nie Post) und dem Code als Passwort.
// Die Platzhalter-Adresse verlässt den Server nie: Anmelden läuft über diese
// Funktion, die nur Nickname + Code annimmt und die Sitzung zurückgibt.
//
// Aktionen (POST, JSON {action, ...}):
//   signup  {nick}               → neues Konto + Spielerzeile, {code, session}
//   login   {nick, code}         → {session}
//   regen   (angemeldet)         → neuer Code, alter ungültig, {code}
//   link    (angemeldet) {email_token}
//           → E-Mail an ein Code-Konto hängen. email_token ist die Sitzung eines
//             frisch per E-Mail-Code bestätigten (leeren) Kontos. Damit ist der
//             Besitz der Adresse bewiesen; das leere Konto wird gelöscht.
//
// Diese Datei enthält nur die Logik, ohne Imports, damit sie sich mit Node
// testen lässt (local-tests/code-login.test.js). index.ts verdrahtet Supabase.

export const DOMAIN = 'code.kickertrainer.invalid';
export const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // ohne 0 O 1 I L
export const CODE_LEN = 12;

export const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

export function newCode(rand: (n: number) => Uint8Array): string {
  // Ablehnungsverfahren: nur Bytes < 248 (= 8·31) verwenden, sonst wären
  // die ersten Zeichen etwas häufiger.
  let s = '';
  while (s.length < CODE_LEN) {
    for (const b of rand(32)) {
      if (b < 248 && s.length < CODE_LEN) s += ALPHA[b % ALPHA.length];
    }
  }
  return s;
}
export const normCode = (c: unknown) => String(c ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
export const normNick = (n: unknown) => String(n ?? '').trim().replace(/\s+/g, ' ');
export const isCodeMail = (e: unknown) => typeof e === 'string' && e.toLowerCase().endsWith('@' + DOMAIN);
// ilike ohne Platzhalter: \ % _ maskieren
export const likeExact = (s: string) => s.replace(/[\\%_]/g, (m) => '\\' + m);

type Deps = {
  admin: any;            // Client mit Service-Schlüssel
  anon: () => any;       // frischer Client ohne Sitzung (für signInWithPassword)
  rand: (n: number) => Uint8Array;
  uuid: () => string;
  now: () => number;
};

function json(o: unknown, status = 200) {
  return new Response(JSON.stringify(o), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });
}
const fail = (error: string, status = 400) => json({ error }, status);

async function userFrom(deps: Deps, token: string | null) {
  if (!token) return null;
  const { data, error } = await deps.admin.auth.getUser(token);
  if (error || !data || !data.user) return null;
  return data.user;
}
async function sessionFor(deps: Deps, email: string, code: string) {
  const { data, error } = await deps.anon().auth.signInWithPassword({ email, password: code });
  if (error || !data || !data.session) return null;
  const s = data.session;
  return { access_token: s.access_token, refresh_token: s.refresh_token };
}
async function accountPlayer(deps: Deps, nick: string) {
  const { data, error } = await deps.admin.from('players').select('id,user_id,nickname')
    .eq('kind', 'account').is('deleted_at', null).ilike('nickname', likeExact(nick)).limit(1);
  if (error) throw error;
  return data && data[0] ? data[0] : null;
}

export async function handle(req: Request, deps: Deps): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return fail('method', 405);
  let body: any;
  try { body = await req.json(); } catch (_) { return fail('json'); }
  const auth = req.headers.get('authorization') || '';
  const bearer = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null;

  try {
    switch (body && body.action) {
      case 'signup': {
        const nick = normNick(body.nick);
        if (nick.length < 3 || nick.length > 20) return fail('nick_len');
        if (await accountPlayer(deps, nick)) return fail('nick_taken', 409);
        const code = newCode(deps.rand);
        const email = deps.uuid() + '@' + DOMAIN;
        const cu = await deps.admin.auth.admin.createUser({
          email, password: code, email_confirm: true, user_metadata: { code_account: true },
        });
        if (cu.error || !cu.data || !cu.data.user) return fail('create_failed: ' + (cu.error && cu.error.message), 500);
        const uid = cu.data.user.id;
        const ins = await deps.admin.from('players').insert({ user_id: uid, nickname: nick, kind: 'account' });
        if (ins.error) {
          await deps.admin.auth.admin.deleteUser(uid);
          return ins.error.code === '23505' ? fail('nick_taken', 409) : fail('player_failed: ' + ins.error.message, 500);
        }
        const session = await sessionFor(deps, email, code);
        if (!session) return fail('session_failed', 500);
        return json({ code, session });
      }
      case 'login': {
        const nick = normNick(body.nick), code = normCode(body.code);
        if (nick.length < 3 || code.length !== CODE_LEN) return fail('login_failed', 401);
        const p = await accountPlayer(deps, nick);
        if (!p || !p.user_id) return fail('login_failed', 401);
        const { data, error } = await deps.admin.auth.admin.getUserById(p.user_id);
        if (error || !data || !data.user || !data.user.email) return fail('login_failed', 401);
        const session = await sessionFor(deps, data.user.email, code);
        if (!session) return fail('login_failed', 401);
        return json({ session });
      }
      case 'regen': {
        const u = await userFrom(deps, bearer);
        if (!u) return fail('auth', 401);
        const { data: pl } = await deps.admin.from('players').select('id').eq('user_id', u.id).eq('kind', 'account').limit(1);
        if (!pl || !pl.length) return fail('no_player', 409); // ohne Nickname keine Code-Anmeldung möglich
        const code = newCode(deps.rand);
        const up = await deps.admin.auth.admin.updateUserById(u.id, { password: code });
        if (up.error) return fail('update_failed: ' + up.error.message, 500);
        return json({ code });
      }
      case 'link': {
        const a = await userFrom(deps, bearer);
        if (!a) return fail('auth', 401);
        if (!isCodeMail(a.email)) return fail('has_email', 409);
        const b = await userFrom(deps, typeof body.email_token === 'string' ? body.email_token : null);
        if (!b || !b.email || b.id === a.id || isCodeMail(b.email)) return fail('email_token', 400);
        // Nur ein frisch angelegtes, leeres Konto darf aufgelöst werden.
        const fresh = deps.now() - Date.parse(b.created_at || '') < 30 * 60 * 1000;
        const { data: bp } = await deps.admin.from('players').select('id').eq('user_id', b.id).limit(1);
        const { data: bs } = await deps.admin.from('sessions').select('id').eq('user_id', b.id).limit(1);
        if (!fresh || (bp && bp.length) || (bs && bs.length)) return fail('email_taken', 409);
        const del = await deps.admin.auth.admin.deleteUser(b.id);
        if (del.error) return fail('delete_failed: ' + del.error.message, 500);
        const up = await deps.admin.auth.admin.updateUserById(a.id, { email: b.email, email_confirm: true });
        if (up.error) return fail('update_failed: ' + up.error.message, 500);
        return json({ email: b.email });
      }
      default:
        return fail('action');
    }
  } catch (e) {
    return fail('server: ' + String((e && (e as any).message) || e).slice(0, 120), 500);
  }
}
