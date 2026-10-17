import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import worker, { fetchCandles, runAlerts, companyLocation } from '../src/worker.js';

// Lager et Yahoo-lignende svar: nedtur, sidelengs, så kraftig oppgang.
function yahoo(symbol, closes) {
  const start = Date.UTC(2024, 0, 1) / 1000 + 7 * 3600;
  return {
    chart: {
      result: [{
        meta: { symbol, currency: 'NOK', longName: `${symbol} ASA`, gmtoffset: 7200, fullExchangeName: 'Oslo' },
        timestamp: closes.map((_, i) => start + i * 86400),
        indicators: { quote: [{
          open: closes, close: closes, volume: closes.map(() => 1000),
          high: closes.map((c) => c + 1), low: closes.map((c) => c - 1),
        }] },
      }],
      error: null,
    },
  };
}
// Kuttet slik at siste candle er dagen det sterke signalet slår inn.
const rising = [...Array.from({ length: 80 }, (_, i) => 200 - i), ...Array(40).fill(120), ...Array.from({ length: 10 }, (_, i) => 120 + i * 2.5)];
const falling = Array.from({ length: 150 }, (_, i) => 300 - i);

let sent;
beforeEach(() => {
  sent = [];
  globalThis.fetch = async (url, opts) => {
    url = String(url);
    if (url.startsWith('https://ntfy.sh/')) { sent.push({ url, title: opts.headers.Title, body: opts.body }); return new Response('ok'); }
    const sym = decodeURIComponent(url.match(/chart\/([^?]+)/)[1]);
    if (sym === 'NONE.OL') return new Response(JSON.stringify({ chart: { result: null, error: { description: 'No data found' } } }), { status: 404 });
    return new Response(JSON.stringify(yahoo(sym, sym === 'UP.OL' ? rising : falling)));
  };
});

function kv() {
  const m = new Map();
  return {
    async get(k, type) { const v = m.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
  };
}

test('fetchCandles normaliserer og gir dato i børsens tidssone', async () => {
  const d = await fetchCandles('UP.OL');
  assert.equal(d.candles.length, rising.length);
  assert.equal(d.candles[0].time, '2024-01-01');
  assert.equal(d.name, 'UP.OL ASA');
});

const CREDS = { APP_USER: 'ole', APP_PASSWORD: 'hemmelig-passord' };
async function loginCookie(env, username = 'ole', password = 'hemmelig-passord') {
  const r = await worker.fetch(new Request('https://x/api/login', { method: 'POST', body: JSON.stringify({ username, password }) }), env);
  return { status: r.status, cookie: (r.headers.get('set-cookie') || '').split(';')[0] };
}

test('API: chart, scan og ugyldig ticker', async () => {
  const env = { STATE: kv(), ASSETS: { fetch: () => new Response('asset') }, ...CREDS };
  const { cookie } = await loginCookie(env);
  const Request = class extends globalThis.Request { constructor(u, o = {}) { super(u, { ...o, headers: { cookie } }); } };
  let r = await worker.fetch(new Request('https://x/api/chart?symbol=UP.OL'), env);
  assert.equal(r.status, 200);
  r = await worker.fetch(new Request('https://x/api/chart?symbol=<script>'), env);
  assert.equal(r.status, 400);
  r = await worker.fetch(new Request('https://x/api/scan?symbols=UP.OL,DOWN.OL,NONE.OL'), env);
  const s = await r.json();
  assert.equal(s['DOWN.OL'].signal, 'under');
  assert.ok(s['NONE.OL'].error);
  r = await worker.fetch(new Request('https://x/'), env);
  assert.equal(await r.text(), 'asset');
});

test('varsler bare én gang per nytt kjøpssignal', async () => {
  const env = { STATE: kv(), NTFY_TOPIC: 'test' };
  await env.STATE.put('watchlist', JSON.stringify(['UP.OL', 'DOWN.OL']));
  const first = await runAlerts(env);
  assert.equal(first.sent, 1);
  assert.match(sent[0].title, /UP\.OL: Sterkt kjøpssignal/);
  const second = await runAlerts(env);
  assert.equal(second.sent, 0);
});

test('finner hovedkontor via Brønnøysund og Kartverket', async () => {
  const calls = [];
  globalThis.fetch = async (url) => {
    url = String(url); calls.push(url);
    if (url.includes('/enheter?')) return new Response(JSON.stringify({ _embedded: { enheter: [
      { organisasjonsnummer: '111111111', navn: 'EQUINOR ENERGY AS' },
      { organisasjonsnummer: '923609016', navn: 'EQUINOR ASA', forretningsadresse: {} },
    ] } }));
    if (url.includes('/enheter/923609016')) return new Response(JSON.stringify({
      navn: 'EQUINOR ASA', forretningsadresse: { adresse: ['Forusbeen 50'], postnummer: '4035', poststed: 'STAVANGER', landkode: 'NO' },
    }));
    if (url.includes('ws.geonorge.no')) return new Response(JSON.stringify({ adresser: [{ representasjonspunkt: { lat: 58.89, lon: 5.72 } }] }));
    throw new Error('uventet ' + url);
  };
  const env = { STATE: kv() };
  const r = await companyLocation('EQNR.OL', 'Equinor ASA', env);
  assert.equal(r.orgnr, '923609016');
  assert.equal(r.address, 'Forusbeen 50, 4035 Stavanger');
  assert.equal(r.name, 'Equinor ASA');
  assert.deepEqual(r.point, { lat: 58.89, lon: 5.72 });
  assert.equal(r.exact, true);
  const n = calls.length;
  await companyLocation('EQNR.OL', 'Equinor ASA', env);
  assert.equal(calls.length, n, 'andre oppslag kommer fra cache');
  assert.deepEqual(await companyLocation('AAPL', 'Apple Inc.', env), { norwegian: false });
});

test('innlogging: krever cookie, avviser feil passord og stopper gjetting', async () => {
  const env = { STATE: kv(), ASSETS: { fetch: (req) => new Response('asset:' + new URL(req.url).pathname) }, ...CREDS };
  let r = await worker.fetch(new Request('https://x/api/watchlist'), env);
  assert.equal(r.status, 401);
  r = await worker.fetch(new Request('https://x/'), env);
  assert.equal(r.status, 302);
  assert.match(r.headers.get('location'), /\/login\?neste=%2F$/);
  r = await worker.fetch(new Request('https://x/login'), env);
  assert.equal(await r.text(), 'asset:/login');

  assert.equal((await loginCookie(env, 'ole', 'feil')).status, 401);
  const ok = await loginCookie(env);
  assert.equal(ok.status, 200);
  assert.match(ok.cookie, /^sv_session=/);
  r = await worker.fetch(new Request('https://x/', { headers: { cookie: ok.cookie } }), env);
  assert.equal(await r.text(), 'asset:/');

  // Forfalsket eller gammel cookie slippes ikke inn, og nytt passord ugyldiggjør økten.
  r = await worker.fetch(new Request('https://x/api/watchlist', { headers: { cookie: ok.cookie.slice(0, -3) + 'abc' } }), env);
  assert.equal(r.status, 401);
  r = await worker.fetch(new Request('https://x/api/watchlist', { headers: { cookie: ok.cookie } }), { ...env, APP_PASSWORD: 'nytt' });
  assert.equal(r.status, 401);

  for (let i = 0; i < 8; i++) await loginCookie(env, 'ole', 'feil' + i);
  assert.equal((await loginCookie(env)).status, 429, 'blokkert etter mange feil');
});

test('innlogging uten oppsatte secrets er stengt', async () => {
  const env = { STATE: kv(), ASSETS: { fetch: () => new Response('asset') } };
  assert.equal((await loginCookie(env)).status, 503);
  assert.equal((await worker.fetch(new Request('https://x/api/scan?symbols=UP.OL'), env)).status, 401);
});

test('nøkkeltall fra Yahoo med cookie og crumb, og cache', async () => {
  const { fundamentals } = await import('../src/fundamentals.js');
  const calls = [];
  globalThis.fetch = async (url, opts = {}) => {
    url = String(url); calls.push(url);
    if (url.startsWith('https://fc.yahoo.com')) return new Response('', { status: 404, headers: { 'set-cookie': 'A3=abc; Domain=.yahoo.com; Path=/' } });
    if (url.includes('getcrumb')) { assert.equal(opts.headers.cookie, 'A3=abc'); return new Response('crumb123'); }
    if (url.includes('quoteSummary')) {
      assert.match(url, /crumb=crumb123/);
      return new Response(JSON.stringify({ quoteSummary: { result: [{
        price: { currency: 'NOK', regularMarketPrice: { raw: 250 }, marketCap: { raw: 7e11 } },
        summaryDetail: { trailingPE: { raw: 8.5 }, dividendYield: { raw: 0.09 }, fiftyTwoWeekHigh: { raw: 300 }, fiftyTwoWeekLow: { raw: 220 } },
        defaultKeyStatistics: { priceToBook: { raw: 1.9 } },
        financialData: { returnOnEquity: { raw: 0.21 }, recommendationKey: 'hold', financialCurrency: 'USD' },
        recommendationTrend: { trend: [{ period: '0m', strongBuy: 2, buy: 3, hold: 10, sell: 1, strongSell: 0 }] },
      }] } }));
    }
    throw new Error('uventet ' + url);
  };
  const env = { STATE: kv() };
  const f = await fundamentals('EQNR.OL', env);
  assert.equal(f.available, true);
  assert.equal(f.pe, 8.5);
  assert.equal(f.dividendYield, 0.09);
  assert.equal(f.financialCurrency, 'USD');
  assert.deepEqual(f.recommendationCounts, { kjop: 5, hold: 10, selg: 1 });
  const n = calls.length;
  await fundamentals('EQNR.OL', env);
  assert.equal(calls.length, n, 'andre oppslag fra cache');

  globalThis.fetch = async () => new Response('nei', { status: 500 });
  const bad = await fundamentals('FEIL.OL', { STATE: kv() });
  assert.equal(bad.available, false);
});

test('scan og varsler følger valgt strategi', async () => {
  const env = { STATE: kv(), NTFY_TOPIC: 't', ...CREDS };
  const { cookie } = await loginCookie(env);
  const req = (path, o = {}) => worker.fetch(new Request('https://x' + path, { ...o, headers: { cookie } }), env);
  let r = await req('/api/scan?symbols=DOWN.OL&strategy=combo');
  const s = await r.json();
  assert.equal(s['DOWN.OL'].max, 3);
  assert.equal((await req('/api/scan?symbols=DOWN.OL&strategy=tull')).status, 400);
  r = await req('/api/settings', { method: 'PUT', body: JSON.stringify({ strategy: 'combo' }) });
  assert.deepEqual(await r.json(), { strategy: 'combo' });
  await env.STATE.put('watchlist', JSON.stringify(['DOWN.OL']));
  await runAlerts(env);
  assert.ok(await env.STATE.get('laststatus:combo'), 'status lagres per strategi');
});
