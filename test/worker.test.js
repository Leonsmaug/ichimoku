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

test('API: chart, scan og ugyldig ticker', async () => {
  const env = { STATE: kv(), ASSETS: { fetch: () => new Response('asset') } };
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
