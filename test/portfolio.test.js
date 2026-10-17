import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../src/worker.js';
import { cleanPortfolio, resolve } from '../src/portfolio.js';

function kv() {
  const m = new Map();
  return {
    async get(k, type) { const v = m.get(k); return v == null ? null : type === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { m.set(k, v); },
  };
}
const meta = (price, currency, prev = price) => new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: price, chartPreviousClose: prev, currency } }] } }));

test('cleanPortfolio beholder kjente felt og avviser ugyldig ticker', () => {
  const p = cleanPortfolio({ asOf: '2026-10-16', accounts: [{ name: 'A', cash: 10, holdings: [
    { name: 'X', ticker: '<bad>', qty: 2, currency: 'NOK', valueNok: 100, resultNok: 20, hemmelig: 1 },
  ] }] });
  assert.equal(p.accounts[0].holdings[0].ticker, null);
  assert.equal(p.accounts[0].holdings[0].hemmelig, undefined);
  assert.throws(() => cleanPortfolio({}));
});

test('porteføljen krever innlogging og lagres i KV', async () => {
  const env = { STATE: kv(), ASSETS: { fetch: () => new Response('asset') }, APP_USER: 'ole', APP_PASSWORD: 'pw' };
  let r = await worker.fetch(new Request('https://x/api/portfolio'), env);
  assert.equal(r.status, 401);
  const login = await worker.fetch(new Request('https://x/api/login', { method: 'POST', body: JSON.stringify({ username: 'ole', password: 'pw' }) }), env);
  const cookie = login.headers.get('set-cookie').split(';')[0];
  r = await worker.fetch(new Request('https://x/api/portfolio', { method: 'PUT', headers: { cookie }, body: JSON.stringify({ accounts: [{ name: 'A', cash: 5, holdings: [] }] }) }), env);
  assert.equal(r.status, 200);
  r = await worker.fetch(new Request('https://x/api/portfolio', { headers: { cookie } }), env);
  assert.equal((await r.json()).accounts[0].name, 'A');
});

test('resolve godtar bare treff med riktig valuta og kurs nær rapporten', async () => {
  globalThis.fetch = async (url) => {
    url = String(url);
    if (url.includes('/search')) return new Response(JSON.stringify({ quotes: [
      { symbol: 'WRONG.L', quoteType: 'ETF' }, { symbol: 'FAR.DE', quoteType: 'ETF' }, { symbol: 'RIGHT.DE', quoteType: 'ETF' },
    ] }));
    if (url.includes('WRONG.L')) return meta(950, 'GBp');
    if (url.includes('FAR.DE')) return meta(20, 'EUR');
    return meta(9.9, 'EUR');
  };
  const r = await resolve('iShares AI Infrastructure', 'EUR', 9.65, { STATE: kv() });
  assert.equal(r.symbol, 'RIGHT.DE');
});
