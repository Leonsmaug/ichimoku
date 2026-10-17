// Enkel innlogging: brukernavn og passord ligger som secrets (APP_USER, APP_PASSWORD)
// i Cloudflare. Ved riktig innlogging får nettleseren en signert cookie som varer i 30 dager.

const COOKIE = 'sv_session';
const MAX_AGE = 30 * 86400;
const MAX_FAILS = 8; // per IP per kvarter
const enc = new TextEncoder();

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

async function hmac(env, data) {
  // Nøkkelen avhenger av passordet, så alle økter blir ugyldige når du bytter passord.
  const key = await crypto.subtle.importKey('raw', enc.encode(`${env.SESSION_SECRET || ''}|${env.APP_USER}|${env.APP_PASSWORD}`),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return b64url(await crypto.subtle.sign('HMAC', key, enc.encode(data)));
}

// Sammenligner via HMAC så tiden ikke avslører hvor mye som stemte.
async function safeEqual(env, a, b) {
  const [x, y] = await Promise.all([hmac(env, `cmp:${a}`), hmac(env, `cmp:${b}`)]);
  return x === y;
}

export const authConfigured = (env) => !!(env.APP_USER && env.APP_PASSWORD);

function readCookie(request) {
  const m = (request.headers.get('cookie') || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
  return m ? m[1] : null;
}

export async function isLoggedIn(request, env) {
  if (!authConfigured(env)) return false;
  const token = readCookie(request);
  if (!token) return false;
  const [payload, sig] = token.split('.');
  if (!payload || !sig || !(await safeEqual(env, sig, await hmac(env, payload)))) return false;
  const exp = Number(payload.split(':')[1]);
  return Number.isFinite(exp) && exp > Date.now() / 1000;
}

async function sessionCookie(env, user) {
  const payload = `${b64url(enc.encode(user))}:${Math.floor(Date.now() / 1000) + MAX_AGE}`;
  return `${COOKIE}=${payload}.${await hmac(env, payload)}; Path=/; Max-Age=${MAX_AGE}; HttpOnly; Secure; SameSite=Lax`;
}

const json = (data, status, headers = {}) => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers },
});

export async function login(request, env) {
  if (!authConfigured(env)) return json({ error: 'Innlogging er ikke satt opp. Legg inn APP_USER og APP_PASSWORD som secrets i Cloudflare.' }, 503);
  const ip = request.headers.get('cf-connecting-ip') || 'ukjent';
  const failKey = `loginfail:${ip}`;
  const fails = env.STATE ? Number(await env.STATE.get(failKey)) || 0 : 0;
  if (fails >= MAX_FAILS) return json({ error: 'For mange forsøk. Prøv igjen om et kvarter.' }, 429);

  let body = {};
  try { body = await request.json(); } catch {}
  const userOk = await safeEqual(env, String(body.username || ''), env.APP_USER);
  const passOk = await safeEqual(env, String(body.password || ''), env.APP_PASSWORD);
  if (!userOk || !passOk) {
    if (env.STATE) await env.STATE.put(failKey, String(fails + 1), { expirationTtl: 900 });
    return json({ error: 'Feil brukernavn eller passord.' }, 401);
  }
  return json({ ok: true }, 200, { 'set-cookie': await sessionCookie(env, env.APP_USER) });
}

export function logout() {
  return json({ ok: true }, 200, { 'set-cookie': `${COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax` });
}
