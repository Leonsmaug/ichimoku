// CCI, Bollinger Bands og MACD, og et samlet kjøpssignal fra de tre.
// Brukes av både nettsiden og workeren.

export const COMBO = { bb: 20, bbStd: 2, cci: 20, fast: 12, slow: 26, signal: 9, window: 8 };

export function sma(values, period) {
  const out = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

export function ema(values, period) {
  const out = new Array(values.length).fill(null);
  const k = 2 / (period + 1);
  let prev = null, start = values.findIndex((v) => v != null);
  if (start < 0) return out;
  for (let i = start; i < values.length; i++) {
    if (i < start + period - 1) continue;
    if (prev == null) {
      prev = values.slice(start, start + period).reduce((s, v) => s + v, 0) / period; // start med snitt
    } else {
      prev = values[i] * k + prev * (1 - k);
    }
    out[i] = prev;
  }
  return out;
}

export function bollinger(closes, period = COMBO.bb, mult = COMBO.bbStd) {
  const mid = sma(closes, period);
  const upper = mid.map(() => null), lower = mid.map(() => null);
  for (let i = period - 1; i < closes.length; i++) {
    let v = 0;
    for (let j = i - period + 1; j <= i; j++) v += (closes[j] - mid[i]) ** 2;
    const sd = Math.sqrt(v / period);
    upper[i] = mid[i] + mult * sd;
    lower[i] = mid[i] - mult * sd;
  }
  return { mid, upper, lower };
}

export function cci(candles, period = COMBO.cci) {
  const tp = candles.map((c) => (c.high + c.low + c.close) / 3);
  const avg = sma(tp, period);
  return tp.map((t, i) => {
    if (avg[i] == null) return null;
    let md = 0;
    for (let j = i - period + 1; j <= i; j++) md += Math.abs(tp[j] - avg[i]);
    md /= period;
    return md === 0 ? 0 : (t - avg[i]) / (0.015 * md);
  });
}

export function macd(closes, fast = COMBO.fast, slow = COMBO.slow, signal = COMBO.signal) {
  const f = ema(closes, fast), s = ema(closes, slow);
  const line = closes.map((_, i) => (f[i] != null && s[i] != null ? f[i] - s[i] : null));
  const sig = ema(line, signal);
  const hist = line.map((v, i) => (v != null && sig[i] != null ? v - sig[i] : null));
  return { line, signal: sig, hist };
}

export function comboIndicators(candles) {
  const closes = candles.map((c) => c.close);
  return { bb: bollinger(closes), cci: cci(candles), macd: macd(closes), params: COMBO };
}

// Betingelsene på indeks i. Hver hendelse må ha skjedd innenfor de siste `window` periodene.
export function comboConditionsAt(candles, ind, i) {
  const W = ind.params.window;
  const { bb, cci: c, macd: m } = ind;
  let cciUp = false, bbTouch = false, macdUp = false;
  for (let j = i; j > i - W && j > 0; j--) {
    if (c[j - 1] != null && c[j - 1] < -100 && c[j] >= -100) cciUp = true;
    if (bb.lower[j] != null && candles[j].low <= bb.lower[j]) bbTouch = true;
    if (m.line[j - 1] != null && m.signal[j - 1] != null && m.line[j - 1] <= m.signal[j - 1] && m.line[j] > m.signal[j]) macdUp = true;
  }
  const close = candles[i].close;
  const bbBounce = bbTouch && bb.lower[i] != null && close > bb.lower[i];
  const macdAbove = m.line[i] != null && m.signal[i] != null && m.line[i] > m.signal[i];
  return {
    cciUp,
    bbBounce,
    macdUp: macdUp && macdAbove,
    aboveMid: bb.mid[i] != null && close > bb.mid[i],
    macdAbove,
    cci: c[i],
    percentB: bb.upper[i] != null ? (close - bb.lower[i]) / (bb.upper[i] - bb.lower[i]) : null,
    hist: m.hist[i],
  };
}

export function analyzeCombo(candles) {
  const ind = comboIndicators(candles);
  const n = candles.length;
  const start = COMBO.slow + COMBO.signal + 1;
  const events = [];
  let prevStrong = false;
  for (let i = start; i < n; i++) {
    const k = comboConditionsAt(candles, ind, i);
    const strong = k.cciUp && k.bbBounce && k.macdUp;
    if (strong && !prevStrong) events.push({ index: i, time: candles[i].time, type: 'sterk' });
    prevStrong = strong;
  }
  if (n <= start) return { ind, events, status: null };
  const k = comboConditionsAt(candles, ind, n - 1);
  const score = [k.cciUp, k.bbBounce, k.macdUp].filter(Boolean).length;
  let signal;
  if (score === 3) signal = 'sterk';
  else if (score === 2) signal = 'svak';
  else if (k.aboveMid && k.macdAbove) signal = 'over';
  else if (!k.aboveMid && !k.macdAbove) signal = 'under';
  else signal = 'noytral';
  return { ind, events, status: { signal, score, max: 3, conditions: k, close: candles[n - 1].close, time: candles[n - 1].time } };
}
