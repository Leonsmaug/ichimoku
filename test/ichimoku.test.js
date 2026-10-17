import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ichimoku, analyze } from '../public/ichimoku.js';

function series(closes) {
  return closes.map((c, i) => ({
    time: new Date(Date.UTC(2024, 0, 1) + i * 864e5).toISOString().slice(0, 10),
    open: c, high: c + 1, low: c - 1, close: c, volume: 1000,
  }));
}

test('tenkan og kijun er midtpunkt av høy/lav', () => {
  const c = series(Array.from({ length: 60 }, (_, i) => 100 + i));
  const ich = ichimoku(c);
  // Siste 9: close 151..159, høy 160, lav 150 -> 155
  assert.equal(ich.tenkan[59], 155);
  // Siste 26: close 134..159, høy 160, lav 133 -> 146.5
  assert.equal(ich.kijun[59], 146.5);
  assert.equal(ich.tenkan[7], null);
});

test('senkou forskyves 26 perioder', () => {
  const c = series(Array.from({ length: 100 }, (_, i) => 100 + Math.sin(i / 5) * 10));
  const ich = ichimoku(c);
  assert.equal(ich.spanA[90], ich.futureA[64]);
  assert.equal(ich.spanB[90], ich.futureB[64]);
});

test('fallende aksje havner under skyen', () => {
  const c = series(Array.from({ length: 150 }, (_, i) => 300 - i));
  const { status } = analyze(c);
  assert.equal(status.signal, 'under');
  assert.equal(status.conditions.aboveCloud, false);
});

test('bunn og kraftig vending gir sterkt kjøpssignal', () => {
  // Lang nedtur, sidelengs, så kraftig oppgang: TK-kryss skjer over skyen.
  const closes = [
    ...Array.from({ length: 80 }, (_, i) => 200 - i),
    ...Array.from({ length: 40 }, () => 120),
    ...Array.from({ length: 30 }, (_, i) => 120 + i * 2.5),
  ];
  const c = series(closes);
  const { events } = analyze(c);
  assert.ok(events.some((e) => e.type === 'sterk'), 'forventet minst ett sterkt signal');
});

test('for kort historikk gir ingen status', () => {
  const { status } = analyze(series(Array.from({ length: 50 }, () => 100)));
  assert.equal(status, null);
});
