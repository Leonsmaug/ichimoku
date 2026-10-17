// Ichimoku-beregning og kjøpssignaler. Brukes av både nettsiden og workeren,
// slik at grafen og varslene alltid gir samme svar.

export const DEFAULTS = { tenkan: 9, kijun: 26, senkou: 52, shift: 26, tkLookback: 5 };

function midpoint(candles, end, period) {
  if (end - period + 1 < 0) return null;
  let hi = -Infinity, lo = Infinity;
  for (let i = end - period + 1; i <= end; i++) {
    if (candles[i].high > hi) hi = candles[i].high;
    if (candles[i].low < lo) lo = candles[i].low;
  }
  return (hi + lo) / 2;
}

// Returnerer arrays med samme lengde som candles. spanA/spanB er verdiene som
// gjelder FOR indeks i (dvs. beregnet 26 perioder tidligere). futureA/futureB er
// beregnet på i og tegnes 26 perioder fremover.
export function ichimoku(candles, p = DEFAULTS) {
  const n = candles.length;
  const tenkan = new Array(n).fill(null);
  const kijun = new Array(n).fill(null);
  const futureA = new Array(n).fill(null);
  const futureB = new Array(n).fill(null);
  for (let i = 0; i < n; i++) {
    tenkan[i] = midpoint(candles, i, p.tenkan);
    kijun[i] = midpoint(candles, i, p.kijun);
    if (tenkan[i] != null && kijun[i] != null) futureA[i] = (tenkan[i] + kijun[i]) / 2;
    futureB[i] = midpoint(candles, i, p.senkou);
  }
  const spanA = new Array(n).fill(null);
  const spanB = new Array(n).fill(null);
  for (let i = p.shift; i < n; i++) {
    spanA[i] = futureA[i - p.shift];
    spanB[i] = futureB[i - p.shift];
  }
  return { tenkan, kijun, spanA, spanB, futureA, futureB, params: p };
}

// De fire betingelsene for sterkt kjøpssignal, vurdert på indeks i.
export function conditionsAt(candles, ich, i) {
  const p = ich.params;
  const c = candles[i].close;
  const a = ich.spanA[i], b = ich.spanB[i];
  const aboveCloud = a != null && b != null && c > Math.max(a, b);
  const belowCloud = a != null && b != null && c < Math.min(a, b);

  let tkCross = false;
  if (ich.tenkan[i] != null && ich.kijun[i] != null && ich.tenkan[i] > ich.kijun[i]) {
    for (let j = i; j > i - p.tkLookback && j > 0; j--) {
      const t0 = ich.tenkan[j - 1], k0 = ich.kijun[j - 1];
      if (t0 != null && k0 != null && t0 <= k0 && ich.tenkan[j] > ich.kijun[j]) { tkCross = true; break; }
    }
  }
  const chikouAbove = i - p.shift >= 0 && c > candles[i - p.shift].close;
  const futureGreen = ich.futureA[i] != null && ich.futureB[i] != null && ich.futureA[i] > ich.futureB[i];

  let breakout = false;
  if (aboveCloud && i > 0) {
    const pa = ich.spanA[i - 1], pb = ich.spanB[i - 1];
    breakout = pa != null && pb != null && candles[i - 1].close <= Math.max(pa, pb);
  }
  return { aboveCloud, belowCloud, tkCross, chikouAbove, futureGreen, breakout };
}

const isStrong = (k) => k.aboveCloud && k.tkCross && k.chikouAbove && k.futureGreen;

// Status for siste lukkede candle, pluss historiske signaler til markører i grafen.
export function analyze(candles, p = DEFAULTS) {
  const ich = ichimoku(candles, p);
  const n = candles.length;
  const events = [];
  let prevStrong = false;
  for (let i = p.senkou + p.shift; i < n; i++) {
    const k = conditionsAt(candles, ich, i);
    const strong = isStrong(k);
    if (strong && !prevStrong) events.push({ index: i, time: candles[i].time, type: 'sterk' });
    else if (k.breakout && !strong) events.push({ index: i, time: candles[i].time, type: 'brudd' });
    prevStrong = strong;
  }
  if (n < p.senkou + p.shift + 1) return { ich, events, status: null };

  const k = conditionsAt(candles, ich, n - 1);
  const score = [k.aboveCloud, k.tkCross, k.chikouAbove, k.futureGreen].filter(Boolean).length;
  let signal;
  if (isStrong(k)) signal = 'sterk';
  else if (k.breakout || (k.tkCross && !k.belowCloud)) signal = 'svak';
  else if (k.belowCloud) signal = 'under';
  else if (k.aboveCloud) signal = 'over';
  else signal = 'noytral';
  return { ich, events, status: { signal, score, conditions: k, close: candles[n - 1].close, time: candles[n - 1].time } };
}

export const SIGNAL_TEXT = {
  sterk: 'Sterkt kjøpssignal',
  svak: 'Svakt kjøpssignal',
  over: 'Over skyen',
  noytral: 'I skyen',
  under: 'Under skyen',
};

// Hvordan har sterke kjøpssignaler gått tidligere for denne aksjen?
// Sammenlignes med snittavkastningen for en tilfeldig dag i samme periode.
export function backtest(candles, events, horizons = [20, 60]) {
  const n = candles.length;
  return horizons.map((h) => {
    const rets = events
      .filter((e) => e.type === 'sterk' && e.index + h < n)
      .map((e) => candles[e.index + h].close / candles[e.index].close - 1);
    let base = 0, cnt = 0;
    for (let i = DEFAULTS.senkou + DEFAULTS.shift; i + h < n; i++) { base += candles[i + h].close / candles[i].close - 1; cnt++; }
    const avg = rets.length ? rets.reduce((s, r) => s + r, 0) / rets.length : null;
    const hit = rets.length ? rets.filter((r) => r > 0).length / rets.length : null;
    return { horizon: h, count: rets.length, avg, hit, baseline: cnt ? base / cnt : null };
  });
}

// Nøkkeltall som ikke vises direkte i grafen.
export function insights(candles, result) {
  const { ich, events, status } = result;
  if (!status) return null;
  const n = candles.length, i = n - 1, p = ich.params;
  const close = candles[i].close;
  const top = Math.max(ich.spanA[i], ich.spanB[i]), bottom = Math.min(ich.spanA[i], ich.spanB[i]);
  const distance = close > top ? close / top - 1 : close < bottom ? close / bottom - 1 : 0;

  // Skifter skyen farge i løpet av de neste 26 periodene?
  const nowGreen = ich.futureA[i] > ich.futureB[i];
  const curGreen = ich.spanA[i] > ich.spanB[i];
  let twistIn = null;
  for (let j = i - p.shift + 1; j <= i; j++) {
    if (ich.futureA[j] == null) continue;
    if ((ich.futureA[j] > ich.futureB[j]) !== curGreen) { twistIn = j + p.shift - i; break; }
  }
  const lastStrong = [...events].reverse().find((e) => e.type === 'sterk');
  return {
    distance,
    cloudThickness: (top - bottom) / close,
    curGreen,
    futureGreen: nowGreen,
    twistIn,
    sinceStrong: lastStrong ? i - lastStrong.index : null,
    lastStrongTime: lastStrong?.time ?? null,
  };
}
