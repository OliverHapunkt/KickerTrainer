// Verdrahtung für Supabase Edge Functions. Logik und Erklärung: handler.ts
import { createClient } from 'npm:@supabase/supabase-js@2';
import { handle } from './handler.ts';

const URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON = Deno.env.get('SUPABASE_ANON_KEY')!;
const opt = { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } };
const admin = createClient(URL, SERVICE, opt);

Deno.serve((req) => handle(req, {
  admin,
  anon: () => createClient(URL, ANON, opt),
  rand: (n) => crypto.getRandomValues(new Uint8Array(n)),
  uuid: () => crypto.randomUUID(),
  now: () => Date.now(),
}));
