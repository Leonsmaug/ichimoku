import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sma, ema, bollinger, cci, macd, analyzeCombo } from '../public/indicators.js';

const near = (a, b, eps = 1e-9) => assert.ok(Math.abs(a - b) < eps, `${a} ≉ ${b}`);
const candles = (closes) => closes.map((c, i) => ({
  time: new Date(Date.UTC(2024, 0, 1) + i * 864e5).toISOString().slice(0, 10),
  open: c, high: c + 1, low: c - 1, close: c, volume: 1,
}));

test('SMA og EMA', () => {
  assert.deepEqual(sma([1, 2, 3, 4, 5], 3), [null, null, 2, 3, 4]);
  const e = ema([1, 2, 3, 4, 5], 3);
  assert.equal(e[1], null);
  near(e[2], 2);          // snitt av de tre første
  near(e[3], 4 * 0.5 + 2 * 0.5);
});

test('Bollinger: konstant kurs gir bånd lik kursen', () => {
  const b = bollinger(Array(25).fill(10));
  near(b.upper[24], 10); near(b.lower[24], 10); near(b.mid[24], 10);
});

test('CCI er positiv i oppgang og negativ i nedgang', () => {
  const up = cci(candles(Array.from({ length: 30 }, (_, i) => 100 + i)));
  const down = cci(candles(Array.from({ length: 30 }, (_, i) => 100 - i)));
  assert.ok(up[29] > 100);
  assert.ok(down[29] < -100);
});

test('MACD over signallinjen i oppgang', () => {
  const m = macd(Array.from({ length: 60 }, (_, i) => 100 + i * 0.5 + Math.sin(i) * 0.1));
  assert.ok(m.line[59] > 0);
  assert.equal(m.hist[59] != null, true);
});

test('fall og vending gir sterkt kombinert kjøpssignal', () => {
  // Rolig, så kraftig fall ned under nedre bånd, så rask vending opp.
  const closes = [
    ...Array.from({ length: 60 }, (_, i) => 100 + Math.sin(i / 3)),
    ...Array.from({ length: 12 }, (_, i) => 99 - i * 2),
    ...Array.from({ length: 6 }, (_, i) => 78 + i * 3),
  ];
  const { events, status } = analyzeCombo(candles(closes));
  assert.ok(events.some((e) => e.type === 'sterk'), 'forventet sterkt signal');
  assert.ok(status.score >= 2);
});

test('jevn nedtur gir negativ trend', () => {
  const { status } = analyzeCombo(candles(Array.from({ length: 80 }, (_, i) => 200 - i - i * i / 50)));
  assert.equal(status.signal, 'under');
});
