import { analyze, SIGNAL_TEXT } from '../public/ichimoku.js';
import { isLoggedIn, login, logout } from './auth.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const INTERVALS = { '1d': '2y', '1wk': '10y' };
const SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,20}$/;

function json(data, status = 200, maxAge = 0) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': maxAge ? `public, max-age=${maxAge}` : 'no-store',
    },
  });
}

function toDate(ts, offset) {
  return new Date((ts + offset) * 1000).toISOString().slice(0, 10);
}

// Henter candles fra Yahoo Finance og gjør dem om til et enkelt format.
export async function fetchCandles(symbol, interval = '1d') {
  const range = INTERVALS[interval];
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}&includePrePost=false`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, cf: { cacheTtl: 900, cacheEverything: true } });
  if (!res.ok) throw new Error(`Yahoo svarte ${res.status} for ${symbol}`);
  const body = await res.json();
  const r = body?.chart?.result?.[0];
  if (!r || !r.timestamp) throw new Error(body?.chart?.error?.description || `Fant ingen data for ${symbol}`);
  const q = r.indicators.quote[0];
  const offset = r.meta.gmtoffset || 0;
  const candles = [];
  for (let i = 0; i < r.timestamp.length; i++) {
    if (q.open[i] == null || q.high[i] == null || q.low[i] == null || q.close[i] == null) continue;
    const time = toDate(r.timestamp[i], offset);
    const c = { time, open: q.open[i], high: q.high[i], low: q.low[i], close: q.close[i], volume: q.volume[i] || 0 };
    // Yahoo kan gi to rader for samme dag (siste rad er sanntid); behold den siste.
    if (candles.length && candles[candles.length - 1].time === time) candles[candles.length - 1] = c;
    else candles.push(c);
  }
  return {
    symbol: r.meta.symbol,
    name: r.meta.longName || r.meta.shortName || r.meta.symbol,
    currency: r.meta.currency,
    exchange: r.meta.fullExchangeName || r.meta.exchangeName,
    candles,
  };
}

async function search(q) {
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(q)}&quotesCount=12&newsCount=0&listsCount=0`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, cf: { cacheTtl: 3600, cacheEverything: true } });
  if (!res.ok) throw new Error(`Yahoo-søk svarte ${res.status}`);
  const body = await res.json();
  return (body.quotes || [])
    .filter((x) => x.symbol && (x.quoteType === 'EQUITY' || x.quoteType === 'ETF'))
    .map((x) => ({ symbol: x.symbol, name: x.longname || x.shortname || x.symbol, exchange: x.exchDisp || x.exchange }));
}

// «KONGSBERG GRUPPEN ASA» -> «Kongsberg Gruppen ASA»
const pretty = (s) => s.toLowerCase().replace(/(^|[\s\-/])(\p{L})/gu, (m, a, b) => a + b.toUpperCase())
  .replace(/\b(Asa|As|Sa|Ab|Nv)\b/g, (m) => m.toUpperCase());
const norm = (s) => s.toLowerCase().replace(/[^a-z0-9æøå]/g, '');

// Finner selskapet i Enhetsregisteret ut fra navnet Yahoo oppgir (f.eks. «Equinor ASA»).
async function findOrgnr(name) {
  for (const form of ['ASA', '']) {
    const url = `https://data.brreg.no/enhetsregisteret/api/enheter?navn=${encodeURIComponent(name)}&size=10${form ? `&organisasjonsform=${form}` : ''}`;
    const res = await fetch(url, { headers: { accept: 'application/json' }, cf: { cacheTtl: 86400, cacheEverything: true } });
    if (!res.ok) continue;
    const list = (await res.json())?._embedded?.enheter || [];
    const hit = list.find((e) => norm(e.navn) === norm(name)) || list.find((e) => e.forretningsadresse);
    if (hit) return hit.organisasjonsnummer;
  }
  return null;
}

// Forretningsadresse fra Brønnøysund og koordinater fra Kartverkets adresse-API.
export async function companyLocation(symbol, name, env) {
  if (!symbol.endsWith('.OL')) return { norwegian: false };
  const key = `company:v2:${symbol}`;
  const cached = env?.STATE && (await env.STATE.get(key, 'json'));
  if (cached) return cached;

  const orgnr = await findOrgnr(name.replace(/\s+\(publ\)$/i, ''));
  if (!orgnr) return { norwegian: true, found: false };
  const res = await fetch(`https://data.brreg.no/enhetsregisteret/api/enheter/${orgnr}`, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Brønnøysund svarte ${res.status}`);
  const e = await res.json();
  const a = e.forretningsadresse || e.postadresse;
  if (!a) return { norwegian: true, found: false, orgnr };
  const street = (a.adresse || []).filter(Boolean).join(', ');
  const address = [street, `${a.postnummer || ''} ${pretty(a.poststed || '')}`.trim()].filter(Boolean).join(', ');

  let point = null, exact = false;
  if (a.landkode === 'NO' || !a.landkode) {
    // «Sandviksbodene 77A/B» -> «Sandviksbodene 77A»: Kartverket kjenner bare én bokstav per adresse.
    const firstStreet = (a.adresse || []).find((l) => /\d/.test(l)) || street;
    const q = new URLSearchParams({ sok: firstStreet.replace(/(\d+\s*[A-Za-z]?)\s*[\/-].*$/, '$1') || a.poststed || '', treffPerSide: '1', utkoordsys: '4258' });
    if (a.postnummer) q.set('postnummer', a.postnummer);
    let g = await (await fetch(`https://ws.geonorge.no/adresser/v1/sok?${q}`)).json().catch(() => null);
    exact = !!g?.adresser?.length;
    if (!exact && a.postnummer) {
      // Fant ikke gateadressen: bruk et punkt i postnummeret.
      g = await (await fetch(`https://ws.geonorge.no/adresser/v1/sok?postnummer=${a.postnummer}&treffPerSide=1&utkoordsys=4258`)).json().catch(() => null);
    }
    const p = g?.adresser?.[0]?.representasjonspunkt;
    if (p) point = { lat: p.lat, lon: p.lon };
  }
  const out = { norwegian: true, found: true, orgnr, name: pretty(e.navn), address, point, exact };
  if (env?.STATE) await env.STATE.put(key, JSON.stringify(out), { expirationTtl: 30 * 86400 });
  return out;
}

async function scan(symbols, interval = '1d') {
  const out = {};
  // Små porsjoner så vi holder oss under grensen for samtidige subrequests.
  for (let i = 0; i < symbols.length; i += 6) {
    const batch = symbols.slice(i, i + 6);
    await Promise.all(batch.map(async (s) => {
      try {
        const d = await fetchCandles(s, interval);
        const a = analyze(d.candles);
        out[s] = { name: d.name, currency: d.currency, ...a.status };
      } catch (e) {
        out[s] = { error: String(e.message || e) };
      }
    }));
  }
  return out;
}

async function getWatchlist(env) {
  if (!env.STATE) return [];
  return (await env.STATE.get('watchlist', 'json')) || [];
}

async function notify(env, title, message, symbol) {
  if (!env.NTFY_TOPIC) return;
  await fetch(`https://ntfy.sh/${env.NTFY_TOPIC}`, {
    method: 'POST',
    body: message,
    headers: {
      Title: title,
      Tags: 'chart_with_upwards_trend',
      ...(env.APP_URL ? { Click: `${env.APP_URL}/#${encodeURIComponent(symbol)}` } : {}),
    },
  });
}

// Daglig sjekk: varsle bare når en aksje går INN i et kjøpssignal.
export async function runAlerts(env) {
  const symbols = await getWatchlist(env);
  if (!symbols.length) return { checked: 0, sent: 0 };
  const last = (await env.STATE.get('laststatus', 'json')) || {};
  const result = await scan(symbols);
  let sent = 0;
  for (const [s, st] of Object.entries(result)) {
    if (st.error) continue;
    const prev = last[s]?.signal;
    const isBuy = st.signal === 'sterk' || st.signal === 'svak';
    // Nytt signal, men ikke når et sterkt signal bare svekkes til svakt.
    if (isBuy && prev !== st.signal && prev !== 'sterk') {
      await notify(env, `${s}: ${SIGNAL_TEXT[st.signal]}`,
        `${st.name} lukket på ${st.close.toFixed(2)} ${st.currency || ''} (${st.time}). Ichimoku-score ${st.score}/4. Analyse, ikke investeringsråd.`, s);
      sent++;
    }
    last[s] = { signal: st.signal, time: st.time };
  }
  await env.STATE.put('laststatus', JSON.stringify(last));
  return { checked: symbols.length, sent };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const p = url.pathname;

    // Alt unntatt innloggingssiden krever innlogging.
    if (p === '/api/login' && request.method === 'POST') return login(request, env);
    if (p === '/api/logout' && request.method === 'POST') return logout();
    if (['/login', '/login.html', '/style.css'].includes(p)) return env.ASSETS.fetch(request);
    if (!(await isLoggedIn(request, env))) {
      if (p.startsWith('/api/')) return json({ error: 'Ikke innlogget' }, 401);
      return Response.redirect(new URL(`/login?neste=${encodeURIComponent(p)}`, url).toString(), 302);
    }

    try {
      if (p === '/api/chart') {
        const symbol = url.searchParams.get('symbol') || '';
        const interval = url.searchParams.get('interval') || '1d';
        if (!SYMBOL_RE.test(symbol) || !INTERVALS[interval]) return json({ error: 'Ugyldig ticker eller intervall' }, 400);
        return json(await fetchCandles(symbol, interval), 200, 300);
      }
      if (p === '/api/search') {
        const q = (url.searchParams.get('q') || '').slice(0, 50);
        if (!q) return json([]);
        return json(await search(q), 200, 3600);
      }
      if (p === '/api/scan') {
        const symbols = (url.searchParams.get('symbols') || '').split(',').filter((s) => SYMBOL_RE.test(s)).slice(0, 60);
        const interval = url.searchParams.get('interval') || '1d';
        if (!INTERVALS[interval]) return json({ error: 'Ugyldig intervall' }, 400);
        return json(await scan(symbols, interval), 200, 300);
      }
      if (p === '/api/watchlist') {
        if (request.method === 'PUT') {
          if (!env.STATE) return json({ error: 'KV er ikke koblet til' }, 500);
          const list = await request.json();
          if (!Array.isArray(list)) return json({ error: 'Forventet en liste' }, 400);
          const clean = [...new Set(list.filter((s) => typeof s === 'string' && SYMBOL_RE.test(s)))].slice(0, 100);
          await env.STATE.put('watchlist', JSON.stringify(clean));
          return json(clean);
        }
        return json(await getWatchlist(env));
      }
      if (p === '/api/company') {
        const symbol = url.searchParams.get('symbol') || '';
        const name = (url.searchParams.get('name') || '').slice(0, 120);
        if (!SYMBOL_RE.test(symbol) || !name) return json({ error: 'Mangler ticker eller navn' }, 400);
        return json(await companyLocation(symbol, name, env), 200, 86400);
      }
      if (p === '/api/weights') {
        if (request.method === 'PUT') {
          if (!env.STATE) return json({ error: 'KV er ikke koblet til' }, 500);
          const w = await request.json();
          const clean = Object.fromEntries(Object.entries(w || {})
            .filter(([s, v]) => SYMBOL_RE.test(s) && Number.isFinite(+v) && +v > 0).slice(0, 100).map(([s, v]) => [s, +v]));
          await env.STATE.put('weights', JSON.stringify(clean));
          return json(clean);
        }
        return json((env.STATE && (await env.STATE.get('weights', 'json'))) || {});
      }
      if (p === '/api/test-alert' && request.method === 'POST') {
        if (!env.NTFY_TOPIC) return json({ error: 'NTFY_TOPIC er ikke satt' }, 400);
        await notify(env, 'Ichimoku: testvarsel', 'Varsler fungerer. Du får beskjed når en aksje i watchlisten får nytt kjøpssignal.', '');
        return json({ ok: true });
      }
      if (p.startsWith('/api/')) return json({ error: 'Ukjent endepunkt' }, 404);
    } catch (e) {
      return json({ error: String(e.message || e) }, 502);
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(runAlerts(env));
  },
};
