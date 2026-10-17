import {
  createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries, CrosshairMode, ColorType, LineStyle,
} from './vendor/lightweight-charts.standalone.production.mjs';
import { backtest, insights, DEFAULTS } from './ichimoku.js';
import { COMBO } from './indicators.js';
import { STRATEGIES, strategyOf } from './strategies.js';

const PRESETS = {
  evighet: ['EQNR', 'DNB', 'KOG', 'KMAR', 'NHY', 'MOWI', 'TEL', 'GJF'].map((s) => s + '.OL'),
  obx: ['EQNR', 'DNB', 'AKRBP', 'TEL', 'MOWI', 'NHY', 'YAR', 'ORK', 'KOG', 'GJF', 'STB', 'SALM', 'SUBC',
    'TGS', 'FRO', 'VAR', 'NOD', 'AKER', 'BAKKA', 'SCATC', 'HAFNI', 'MPCC', 'AUTO', 'NAS', 'WAWI'].map((s) => s + '.OL'),
  nasdaq: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'COST', 'NFLX', 'AMD', 'ADBE'],
};
const PRESET_WEIGHTS = { 'EQNR.OL': 18, 'DNB.OL': 17, 'KOG.OL': 15, 'KMAR.OL': 10, 'NHY.OL': 10, 'MOWI.OL': 10, 'TEL.OL': 10, 'GJF.OL': 10 };
const SIGNALS = ['sterk', 'svak', 'over', 'noytral', 'under'];
const LS = { list: 'ichimoku.watchlist', weights: 'ichimoku.weights', theme: 'ichimoku.theme', strategy: 'skyvakt.strategy', tab: 'skyvakt.tab' };

const $ = (id) => document.getElementById(id);
const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const state = {
  list: [], statuses: {}, weights: store.get(LS.weights, {}), current: null, interval: '1d',
  filter: null, donutMode: 'count', lastData: null,
  strategy: STRATEGIES[store.get(LS.strategy)] ? store.get(LS.strategy) : 'ichimoku',
  tab: store.get(LS.tab, 'teknisk') === 'fundamental' ? 'fundamental' : 'teknisk',
  fund: {},
};
const S = () => strategyOf(state.strategy);
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const pct = (x, digits = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toLocaleString('nb-NO', { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;
const fmt = (n) => n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (s) => s.replace(/\.OL$/, '');
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);

// ---------- Tema ----------
function isDark() {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
}
$('theme').addEventListener('click', () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem(LS.theme, next); } catch {}
  applyChartTheme();
  renderDonut();
});
$('logout').addEventListener('click', async () => {
  await fetch('/api/logout', { method: 'POST' }).catch(() => {});
  location.href = '/login';
});
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => { applyChartTheme(); renderDonut(); });

// ---------- Graf ----------
function rgba(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

// Fyller flaten mellom to linjer: skyen i Ichimoku, båndet i Bollinger.
class BandFill {
  constructor() { this.points = []; this.colors = { up: 'rgba(0,128,0,.15)', down: 'rgba(200,0,0,.15)' }; }
  attached({ chart, series, requestUpdate }) { this.chart = chart; this.series = series; this.requestUpdate = requestUpdate; }
  setPoints(points) { this.points = points; this.requestUpdate?.(); }
  updateAllViews() {}
  paneViews() {
    const self = this;
    return [{
      zOrder: () => 'bottom',
      renderer: () => ({
        draw(target) {
          const ts = self.chart.timeScale();
          const pts = self.points.map((p) => ({
            x: ts.timeToCoordinate(p.time), ya: self.series.priceToCoordinate(p.a), yb: self.series.priceToCoordinate(p.b), up: p.a >= p.b,
          })).filter((p) => p.x != null && p.ya != null && p.yb != null);
          target.useBitmapCoordinateSpace(({ context: ctx, horizontalPixelRatio: hr, verticalPixelRatio: vr }) => {
            for (let i = 1; i < pts.length; i++) {
              const p0 = pts[i - 1], p1 = pts[i];
              ctx.fillStyle = p1.up ? self.colors.up : self.colors.down;
              ctx.beginPath();
              ctx.moveTo(p0.x * hr, p0.ya * vr);
              ctx.lineTo(p1.x * hr, p1.ya * vr);
              ctx.lineTo(p1.x * hr, p1.yb * vr);
              ctx.lineTo(p0.x * hr, p0.yb * vr);
              ctx.closePath();
              ctx.fill();
            }
          });
        },
      }),
    }];
  }
}

// Datoer etter siste candle, så skyen kan tegnes 26 perioder frem i tid.
function futureTimes(last, count, interval) {
  const out = [];
  const d = new Date(last + 'T00:00:00Z');
  while (out.length < count) {
    d.setUTCDate(d.getUTCDate() + (interval === '1wk' ? 7 : 1));
    const wd = d.getUTCDay();
    if (interval === '1d' && (wd === 0 || wd === 6)) continue;
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

// Grafen bygges på nytt når strategien byttes, siden panelene er forskjellige.
let view = null;
function buildChart() {
  view?.chart.remove();
  const chart = createChart($('chart'), {
    autoSize: true,
    crosshair: { mode: CrosshairMode.Normal },
    timeScale: { rightOffset: 4, borderVisible: false },
    rightPriceScale: { borderVisible: false },
    localization: { locale: 'nb-NO' },
  });
  const candles = chart.addSeries(CandlestickSeries, { borderVisible: false });
  const line = (width = 1.5, pane = 0, extra = {}) => chart.addSeries(LineSeries, {
    lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false, ...extra,
  }, pane);
  const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 1);
  const base = { chart, candles, line, volume, markers: createSeriesMarkers(candles, []) };
  view = { ...base, ...(state.strategy === 'combo' ? comboView(base) : ichimokuView(base)) };
  $('legend').innerHTML = view.legend;
  $('chart').closest('.chart-panel').classList.toggle('combo', state.strategy === 'combo');
  applyChartTheme();
}

function drawCommon(c, events) {
  const up = css('--up'), down = css('--down');
  view.candles.setData(c.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  view.volume.setData(c.map((x) => ({ time: x.time, value: x.volume, color: rgba(x.close >= x.open ? up : down, 0.35) })));
  view.markers.setMarkers(events.filter((e) => e.type === 'sterk')
    .map((e) => ({ time: e.time, position: 'belowBar', color: css('--s-sterk'), shape: 'arrowUp', text: 'Kjøp' })));
}

function ichimokuView({ chart, line }) {
  const spanB = line(1), spanA = line(1), tenkan = line(), kijun = line(2), chikou = line(1);
  chart.panes()[1]?.setHeight(80);
  const cloud = new BandFill();
  spanA.attachPrimitive(cloud);
  return {
    legend: `<span><i class="l-tenkan"></i>Tenkan</span><span><i class="l-kijun"></i>Kijun</span>
      <span><i class="l-chikou"></i>Chikou</span><span><i class="l-cloud"></i>Sky</span><span>▲ sterkt kjøpssignal</span>`,
    theme() {
      const up = css('--up'), down = css('--down');
      tenkan.applyOptions({ color: css('--tenkan') });
      kijun.applyOptions({ color: css('--kijun') });
      chikou.applyOptions({ color: rgba(css('--chikou'), 0.8) });
      spanA.applyOptions({ color: rgba(up, 0.7) });
      spanB.applyOptions({ color: rgba(down, 0.7) });
      cloud.colors = { up: rgba(up, 0.16), down: rgba(down, 0.14) };
    },
    draw(data, resetView) {
      const c = data.candles;
      const result = S().analyze(c);
      const { ich, events } = result;
      const shift = DEFAULTS.shift;
      const future = futureTimes(c[c.length - 1].time, shift, state.interval);
      const timeAt = (i) => (i < c.length ? c[i].time : future[i - c.length]);
      const pts = (arr, offset = 0) => arr.map((v, i) => (v == null ? null : { time: timeAt(i + offset), value: v }))
        .filter((p) => p && p.time);
      drawCommon(c, events);
      tenkan.setData(pts(ich.tenkan));
      kijun.setData(pts(ich.kijun));
      chikou.setData(c.slice(shift).map((x, i) => ({ time: c[i].time, value: x.close })));
      const a = pts(ich.futureA, shift), b = pts(ich.futureB, shift);
      spanA.setData(a);
      spanB.setData(b);
      const bByTime = new Map(b.map((p) => [p.time, p.value]));
      cloud.setPoints(a.filter((p) => bByTime.has(p.time)).map((p) => ({ time: p.time, a: p.value, b: bByTime.get(p.time) })));
      if (resetView) setRange(c.length, shift);
      return result;
    },
  };
}

function comboView({ chart, line }) {
  const upper = line(1), lower = line(1), mid = line(1, 0, { lineStyle: LineStyle.Dashed });
  const cciLine = line(1.5, 2, { lastValueVisible: true });
  const hist = chart.addSeries(HistogramSeries, { priceLineVisible: false, lastValueVisible: false }, 3);
  const macdLine = line(1.5, 3, { lastValueVisible: true });
  const signalLine = line(1.2, 3);
  const levels = [100, -100].map((price) => cciLine.createPriceLine({ price, lineWidth: 1, lineStyle: LineStyle.Dashed, axisLabelVisible: true, title: '' }));
  const zero = macdLine.createPriceLine({ price: 0, lineWidth: 1, lineStyle: LineStyle.Dotted, axisLabelVisible: false, title: '' });
  // Relative høyder, så panelene skalerer med vinduet.
  [6, 0.7, 1.4, 1.6].forEach((f, i) => chart.panes()[i]?.setStretchFactor(f));
  const band = new BandFill();
  upper.attachPrimitive(band);
  return {
    legend: `<span><i class="l-bb"></i>Bollinger (20, 2)</span><span><i class="l-cci"></i>CCI (20)</span>
      <span><i class="l-macd"></i>MACD (12, 26)</span><span><i class="l-macd-sig"></i>Signallinje (9)</span><span>▲ sterkt kjøpssignal</span>`,
    theme() {
      const bb = css('--tenkan');
      upper.applyOptions({ color: rgba(bb, 0.8) });
      lower.applyOptions({ color: rgba(bb, 0.8) });
      mid.applyOptions({ color: rgba(bb, 0.55) });
      band.colors = { up: rgba(bb, 0.07), down: rgba(bb, 0.07) };
      cciLine.applyOptions({ color: css('--chikou') });
      macdLine.applyOptions({ color: css('--tenkan') });
      signalLine.applyOptions({ color: css('--kijun') });
      levels.forEach((l) => l.applyOptions({ color: css('--muted') }));
      zero.applyOptions({ color: css('--line') });
    },
    draw(data, resetView) {
      const c = data.candles;
      const result = S().analyze(c);
      const { ind, events } = result;
      const pts = (arr) => arr.map((v, i) => (v == null ? null : { time: c[i].time, value: v })).filter(Boolean);
      drawCommon(c, events);
      upper.setData(pts(ind.bb.upper));
      lower.setData(pts(ind.bb.lower));
      mid.setData(pts(ind.bb.mid));
      band.setPoints(c.map((x, i) => (ind.bb.upper[i] == null ? null : { time: x.time, a: ind.bb.upper[i], b: ind.bb.lower[i] })).filter(Boolean));
      cciLine.setData(pts(ind.cci));
      macdLine.setData(pts(ind.macd.line));
      signalLine.setData(pts(ind.macd.signal));
      const up = css('--up'), down = css('--down');
      hist.setData(ind.macd.hist.map((v, i) => (v == null ? null : { time: c[i].time, value: v, color: rgba(v >= 0 ? up : down, 0.55) })).filter(Boolean));
      if (resetView) setRange(c.length, 4);
      return result;
    },
  };
}

function setRange(n, ahead) {
  const visible = (state.interval === '1wk' ? 156 : 180) / (innerWidth < 760 ? 2 : 1);
  view.chart.timeScale().setVisibleLogicalRange({ from: n - visible, to: n + ahead });
}

function applyChartTheme() {
  if (!view) return;
  const up = css('--up'), down = css('--down');
  view.chart.applyOptions({
    layout: {
      background: { type: ColorType.Solid, color: css('--surface') },
      textColor: css('--muted'),
      fontFamily: 'Inter, sans-serif',
      panes: { separatorColor: css('--line') },
    },
    grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
  });
  view.candles.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down });
  view.theme();
  if (state.lastData) view.draw(state.lastData, false);
}

// ---------- Topp og innsiktspanel ----------
function showHeader(data, status) {
  const c = data.candles;
  const last = c[c.length - 1], prev = c[c.length - 2];
  $('sym').textContent = short(data.symbol);
  $('name').textContent = `${data.name} · ${data.exchange || ''}`;
  $('last').textContent = `${fmt(last.close)} ${data.currency || ''}`;
  const ch = prev ? last.close / prev.close - 1 : 0;
  $('chg').textContent = pct(ch, 2);
  $('chg').className = ch >= 0 ? 'up' : 'down';
  const sig = $('signal');
  sig.className = status ? `badge sig-${status.signal}` : 'badge';
  sig.textContent = status ? `${S().text[status.signal]} · ${status.score}/${status.max}` : 'For lite historikk';
  sig.title = status ? `Signal etter ${S().long}` : '';
}

const conditionList = (rows) => rows.map(([ok, t]) => `<li class="${ok ? 'ok' : 'no'}">${t}</li>`).join('');
const metricList = (rows) => rows.map(([v, t]) => `<div><span>${v}</span><small>${t}</small></div>`).join('');

// Skriver en kort lesning av grafen på vanlig norsk.
function ichimokuStory(sym, status, ins) {
  const per = state.interval === '1wk' ? 'uker' : 'handelsdager';
  const k = status.conditions;
  const parts = [];
  if (k.aboveCloud) parts.push(`<b>${sym}</b> handles ${pct(ins.distance)} over skyen, altså i en opptrend.`);
  else if (k.belowCloud) parts.push(`<b>${sym}</b> handles ${pct(ins.distance)} under skyen, altså i en nedtrend.`);
  else parts.push(`<b>${sym}</b> handles inne i skyen, der trenden er uavklart.`);
  parts.push(ins.futureGreen ? 'Skyen fremover er grønn.' : 'Skyen fremover er rød.');
  if (ins.twistIn != null) parts.push(`Den skifter farge om <b>${ins.twistIn} ${per}</b>, noe som ofte varsler et trendskifte.`);
  if (status.signal === 'sterk') parts.push('Alle fire betingelser for et sterkt kjøpssignal er oppfylt.');
  else if (status.signal === 'svak') parts.push('Det er et svakt kjøpssignal, men ikke alle betingelser er på plass.');
  else if (status.score === 3) parts.push('Én betingelse mangler før det blir et sterkt kjøpssignal.');
  return parts.join(' ');
}

function comboStory(sym, status) {
  const k = status.conditions;
  const parts = [];
  const b = k.percentB;
  if (b != null) {
    if (b < 0) parts.push(`<b>${sym}</b> handles under det nedre Bollinger-båndet, uvanlig lavt mot de siste 20 periodene.`);
    else if (b > 1) parts.push(`<b>${sym}</b> handles over det øvre Bollinger-båndet, uvanlig høyt mot de siste 20 periodene.`);
    else parts.push(`<b>${sym}</b> handles i ${b < 0.5 ? 'nedre' : 'øvre'} halvdel av Bollinger-båndet.`);
  }
  if (k.cci != null) {
    if (k.cci < -100) parts.push('CCI er under −100, som regnes som oversolgt.');
    else if (k.cci > 100) parts.push('CCI er over +100, altså sterkt momentum oppover.');
    else parts.push('CCI er i normalområdet mellom −100 og +100.');
  }
  parts.push(k.macdAbove ? 'MACD ligger over signallinjen, så momentumet er positivt.' : 'MACD ligger under signallinjen, så momentumet er negativt.');
  if (status.signal === 'sterk') parts.push('Alle tre betingelser for et sterkt kjøpssignal er oppfylt.');
  else if (status.signal === 'svak') parts.push('To av tre betingelser er oppfylt, så det er et svakt kjøpssignal.');
  return parts.join(' ');
}

function sinceLast(c, events) {
  const e = events.filter((x) => x.type === 'sterk').at(-1);
  return e ? c.length - 1 - e.index : null;
}

function showInsight(data, result) {
  const { status } = result;
  const per = state.interval === '1wk' ? 'uker' : 'dager';
  const unit = state.interval === '1wk' ? 'u' : 'd';
  $('insight-title').textContent = `Lesning · ${S().label}`;
  $('backtest-sub').textContent = `Sterke kjøpssignaler (${S().label}) på denne aksjen, målt mot en tilfeldig dag i samme periode.`;
  const ins = state.strategy === 'ichimoku' ? insights(data.candles, result) : true;
  if (!status || !ins) {
    $('story').textContent = 'For lite historikk til å regne ut signalet.';
    $('conditions').innerHTML = '';
    $('metrics').innerHTML = '';
    $('backtest').innerHTML = '';
    return;
  }
  const k = status.conditions;
  if (state.strategy === 'ichimoku') {
    $('story').innerHTML = ichimokuStory(short(data.symbol), status, ins);
    $('conditions').innerHTML = conditionList([
      [k.aboveCloud, 'Kurs over skyen'],
      [k.tkCross, `Tenkan krysset over Kijun siste ${DEFAULTS.tkLookback} ${per}`],
      [k.chikouAbove, 'Chikou over kursen for 26 perioder siden'],
      [k.futureGreen, 'Grønn sky fremover'],
    ]);
    $('metrics').innerHTML = metricList([
      [ins.distance === 0 ? 'I skyen' : pct(ins.distance), 'fra skyen'],
      [ins.twistIn == null ? 'Ingen' : `${ins.twistIn} ${unit}`, 'til skyen skifter farge'],
      [ins.sinceStrong == null ? 'Aldri' : `${ins.sinceStrong} ${unit}`, 'siden siste sterke kjøpssignal'],
    ]);
  } else {
    const since = sinceLast(data.candles, result.events);
    $('story').innerHTML = comboStory(short(data.symbol), status);
    $('conditions').innerHTML = conditionList([
      [k.cciUp, `CCI krysset opp gjennom −100 siste ${COMBO.window} ${per}`],
      [k.bbBounce, 'Kursen var nede ved nedre Bollinger-bånd og er tilbake over'],
      [k.macdUp, `MACD krysset over signallinjen siste ${COMBO.window} ${per}`],
    ]);
    $('metrics').innerHTML = metricList([
      [k.cci == null ? '–' : Math.round(k.cci).toLocaleString('nb-NO'), 'CCI nå'],
      [k.percentB == null ? '–' : `${Math.round(k.percentB * 100)} %`, 'plass i Bollinger-båndet (%B)'],
      [since == null ? 'Aldri' : `${since} ${unit}`, 'siden siste sterke kjøpssignal'],
    ]);
  }

  const h = state.interval === '1wk' ? [4, 12] : [20, 60];
  const rows = backtest(data.candles, result.events, h);
  const cls = (x) => (x == null ? '' : x >= 0 ? 'pos' : 'neg');
  if (!rows.some((r) => r.count)) {
    $('backtest').innerHTML = `<tr><td class="empty">Ingen sterke kjøpssignaler med nok historikk etterpå i perioden som vises.</td></tr>`;
    return;
  }
  $('backtest').innerHTML = `
    <tr><th>Etter</th><th>Signaler</th><th>Snitt</th><th>Treff</th><th>Vanlig dag</th></tr>
    ${rows.map((r) => `<tr>
      <td>${r.horizon} ${per}</td>
      <td>${r.count}</td>
      <td class="${cls(r.avg)}">${r.avg == null ? '–' : pct(r.avg)}</td>
      <td>${r.hit == null ? '–' : Math.round(r.hit * 100) + ' %'}</td>
      <td class="${cls(r.baseline)}">${r.baseline == null ? '–' : pct(r.baseline)}</td>
    </tr>`).join('')}`;
}

function redraw(resetView) {
  const data = state.lastData;
  if (!data) return;
  const result = view.draw(data, resetView);
  showHeader(data, result.status);
  showInsight(data, result);
}

// ---------- Fundamental analyse ----------
const num = (x, d = 1) => x.toLocaleString('nb-NO', { minimumFractionDigits: d, maximumFractionDigits: d });
const share = (x, d = 1) => `${num(x * 100, d)} %`;
function big(x) {
  const a = Math.abs(x);
  if (a >= 1e12) return `${num(x / 1e12, 2)} bill.`;
  if (a >= 1e9) return `${num(x / 1e9, 1)} mrd.`;
  if (a >= 1e6) return `${num(x / 1e6, 0)} mill.`;
  return num(x, 0);
}
// Grove tommelfingerregler. Gir en farge og et ord, ikke en dom.
const band = (x, good, ok, higherIsBetter, words) => {
  if (higherIsBetter ? x >= good : x <= good) return ['good', words[0]];
  if (higherIsBetter ? x >= ok : x <= ok) return ['mid', words[1]];
  return ['weak', words[2]];
};
const RULES = {
  pe: (x) => (x <= 0 ? ['weak', 'Underskudd'] : band(x, 12, 25, false, ['Lav', 'Normal', 'Høy'])),
  forwardPe: (x, f) => (x <= 0 ? ['weak', 'Ventet underskudd'] : f.pe > 0 ? (x < f.pe ? ['good', 'Ventet resultatvekst'] : ['weak', 'Ventet svakere resultat']) : null),
  pb: (x) => band(x, 1, 3, false, ['Under bokført verdi', 'Normal', 'Høy']),
  evEbitda: (x) => (x <= 0 ? null : band(x, 8, 14, false, ['Lav', 'Normal', 'Høy'])),
  ps: (x) => band(x, 1, 4, false, ['Lav', 'Normal', 'Høy']),
  peg: (x) => (x <= 0 ? null : band(x, 1, 2, false, ['Billig mot veksten', 'Normal', 'Dyr mot veksten'])),
  roe: (x) => band(x, 0.15, 0.08, true, ['Sterk', 'Grei', 'Svak']),
  roa: (x) => band(x, 0.07, 0.03, true, ['Sterk', 'Grei', 'Svak']),
  profitMargin: (x) => band(x, 0.15, 0.05, true, ['Sterk', 'Grei', 'Svak']),
  operatingMargin: (x) => band(x, 0.15, 0.05, true, ['Sterk', 'Grei', 'Svak']),
  dividendYield: (x) => (x >= 0.04 ? ['good', 'Høy'] : x >= 0.015 ? ['mid', 'Moderat'] : x > 0 ? ['mid', 'Lav'] : ['mid', 'Ingen']),
  payoutRatio: (x) => (x <= 0 ? null : band(x, 0.7, 1, false, ['Bærekraftig', 'Høy', 'Over resultatet'])),
  debtToEquity: (x) => band(x, 50, 150, false, ['Lav gjeld', 'Moderat', 'Høy gjeld']),
  currentRatio: (x) => band(x, 1.5, 1, true, ['God', 'Grei', 'Stram']),
  beta: (x) => [null, x < 0.8 ? 'Svinger lite' : x <= 1.2 ? 'Som markedet' : 'Svinger mye'],
  revenueGrowth: (x) => band(x, 0.1, 0, true, ['Sterk', 'Positiv', 'Fallende']),
  earningsGrowth: (x) => band(x, 0.1, 0, true, ['Sterk', 'Positiv', 'Fallende']),
};
const HELP = {
  pe: 'Pris per aksje delt på resultat per aksje siste 12 måneder. Hvor mange års resultat du betaler.',
  forwardPe: 'P/E regnet på analytikernes forventede resultat neste år.',
  pb: 'Markedsverdi delt på bokført egenkapital.',
  evEbitda: 'Selskapsverdi inkludert gjeld delt på driftsresultat før avskrivninger. Gir lite mening for banker.',
  ps: 'Markedsverdi delt på omsetning siste 12 måneder.',
  peg: 'P/E delt på ventet årlig resultatvekst. Under 1 kan bety at veksten ikke er priset inn.',
  roe: 'Resultat delt på egenkapital. Hvor mye selskapet tjener på eiernes penger.',
  roa: 'Resultat delt på totale eiendeler.',
  profitMargin: 'Resultat etter skatt som andel av omsetningen.',
  operatingMargin: 'Driftsresultat som andel av omsetningen.',
  dividendYield: 'Årlig utbytte delt på aksjekursen.',
  payoutRatio: 'Andel av resultatet som deles ut som utbytte.',
  debtToEquity: 'Rentebærende gjeld delt på egenkapital.',
  currentRatio: 'Omløpsmidler delt på kortsiktig gjeld. Evnen til å betale regningene det neste året.',
  beta: 'Hvor mye aksjen svinger i forhold til markedet. 1 betyr like mye.',
  revenueGrowth: 'Endring i omsetning siste kvartal mot samme kvartal i fjor.',
  earningsGrowth: 'Endring i resultat siste kvartal mot samme kvartal i fjor.',
  eps: 'Resultat per aksje siste 12 måneder.',
};
const REC = { strong_buy: 'Sterkt kjøp', buy: 'Kjøp', hold: 'Hold', underperform: 'Undervekt', sell: 'Selg', strong_sell: 'Sterkt salg' };

function tile(f, key, label, value) {
  const x = f[key];
  if (x == null) return `<div class="tile empty" title="${esc(HELP[key] || '')}"><small>${label}</small><b>–</b><span class="hint">Ikke oppgitt</span></div>`;
  const [tone, word] = RULES[key]?.(x, f) || [null, ''];
  return `<div class="tile${tone ? ' tone-' + tone : ''}" title="${esc(HELP[key] || '')}"><small>${label}</small><b>${value(x)}</b><span class="hint">${word}</span></div>`;
}

function renderFund(f, data) {
  const el = $('fund');
  const cur = f.currency || data?.currency || '';
  if (!f.available) {
    el.innerHTML = `<div class="fund-empty"><h3>Fant ingen nøkkeltall</h3><p>Yahoo Finance svarte ikke med nøkkeltall for ${esc(short(state.current))} akkurat nå${f.reason ? ` (${esc(f.reason)})` : ''}. Fond, indekser og noen små selskaper mangler slike tall.</p></div>`;
    return;
  }
  const x = (d = 1) => (v) => num(v, d);
  const groups = [
    ['Verdsettelse', [
      tile(f, 'pe', 'P/E', x()), tile(f, 'forwardPe', 'Forward P/E', x()), tile(f, 'pb', 'P/B', x(2)),
      tile(f, 'evEbitda', 'EV/EBITDA', x()), tile(f, 'ps', 'P/S', x(2)), tile(f, 'peg', 'PEG', x(2)),
    ]],
    ['Lønnsomhet', [
      tile(f, 'roe', 'Egenkapitalavkastning', share), tile(f, 'roa', 'Totalkapitalavkastning', share),
      tile(f, 'profitMargin', 'Netto margin', share), tile(f, 'operatingMargin', 'Driftsmargin', share),
    ]],
    ['Vekst', [
      tile(f, 'revenueGrowth', 'Omsetningsvekst', (v) => pct(v)), tile(f, 'earningsGrowth', 'Resultatvekst', (v) => pct(v)),
      tile(f, 'eps', 'Resultat per aksje', (v) => `${num(v, 2)} ${f.financialCurrency || cur}`),
    ]],
    ['Utbytte', [
      tile(f, 'dividendYield', 'Direkteavkastning', (v) => share(v, 2)), tile(f, 'payoutRatio', 'Utbyttegrad', (v) => share(v, 0)),
    ]],
    ['Gjeld og risiko', [
      tile(f, 'debtToEquity', 'Gjeld / egenkapital', (v) => `${num(v, 0)} %`), tile(f, 'currentRatio', 'Likviditetsgrad', x(2)),
      tile(f, 'beta', 'Beta', x(2)),
    ]],
  ];
  const rated = groups.flatMap(([, t]) => t).join('');
  const good = (rated.match(/tone-good/g) || []).length;
  const weak = (rated.match(/tone-weak/g) || []).length;
  const total = (rated.match(/tone-/g) || []).length;

  const price = f.price ?? data?.candles?.at(-1)?.close;
  let range = '';
  if (f.high52 != null && f.low52 != null && price != null && f.high52 > f.low52) {
    const pos = Math.min(1, Math.max(0, (price - f.low52) / (f.high52 - f.low52)));
    range = `<div class="range"><div class="range-bar"><i style="left:${pos * 100}%"></i></div>
      <div class="range-lbl"><span>${fmt(f.low52)}</span><span>Nå ${fmt(price)}</span><span>${fmt(f.high52)}</span></div></div>`;
  }
  let analysts = '';
  if (f.targetMean != null && price != null) {
    const up = f.targetMean / price - 1;
    const rc = f.recommendationCounts;
    const n = rc ? rc.kjop + rc.hold + rc.selg : 0;
    analysts = `<div class="analysts">
      <div><small>Kursmål i snitt</small><b>${fmt(f.targetMean)} ${esc(cur)}</b><span class="${up >= 0 ? 'pos' : 'neg'}">${pct(up)} fra i dag</span></div>
      <div><small>Anbefaling</small><b>${REC[f.recommendation] || '–'}</b><span>${f.analysts ? `${f.analysts} analytikere` : ''}</span></div>
      ${n ? `<div class="votes" title="Kjøp ${rc.kjop} · Hold ${rc.hold} · Selg ${rc.selg}">
        <div class="vote-bar"><i class="v-kjop" style="flex:${rc.kjop}"></i><i class="v-hold" style="flex:${rc.hold}"></i><i class="v-selg" style="flex:${rc.selg}"></i></div>
        <div class="vote-lbl"><span>Kjøp ${rc.kjop}</span><span>Hold ${rc.hold}</span><span>Selg ${rc.selg}</span></div></div>` : ''}
    </div>`;
  }
  const facts = [f.sector, f.industry, f.employees ? `${f.employees.toLocaleString('nb-NO')} ansatte` : null].filter(Boolean).map(esc).join(' · ');
  const site = f.website ? ` · <a href="${esc(f.website)}" target="_blank" rel="noopener">${esc(f.website.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</a>` : '';
  el.innerHTML = `
    <div class="fund-head">
      <div><h3>Nøkkeltall</h3><p class="sub">${facts}${site}</p></div>
      <div class="fund-score" title="Antall nøkkeltall som ser sterke ut etter tommelfingerreglene">
        <b>${good}</b><span>av ${total} nøkkeltall ser sterke ut${weak ? `, ${weak} svake` : ''}</span>
      </div>
    </div>
    <div class="fund-market">
      <div><small>Markedsverdi</small><b>${f.marketCap != null ? `${big(f.marketCap)} ${esc(cur)}` : '–'}</b></div>
      <div class="grow"><small>52 ukers spenn</small>${range || '<b>–</b>'}</div>
    </div>
    ${analysts}
    ${groups.map(([h, t]) => `<section class="fgroup"><h4>${h}</h4><div class="tiles">${t.join('')}</div></section>`).join('')}
    <p class="fund-note">Fargene følger grove tommelfingerregler og varierer mye mellom bransjer. Banker, rederier og vekstselskaper må leses på hver sin måte.
      ${f.financialCurrency && f.financialCurrency !== cur ? `Regnskapet føres i ${esc(f.financialCurrency)}, kursen i ${esc(cur)}.` : ''}
      Tall fra Yahoo Finance. Analyse, ikke personlig investeringsrådgivning.</p>`;
}

async function showFundamentals() {
  const symbol = state.current;
  if (!symbol || state.tab !== 'fundamental') return;
  if (!state.fund[symbol]) {
    $('fund').innerHTML = '<p class="fund-loading">Henter nøkkeltall …</p>';
    let f;
    try { f = await api(`/api/fundamentals?symbol=${encodeURIComponent(symbol)}`); } catch (e) { f = { available: false, reason: e.message }; }
    if (f.available) state.fund[symbol] = f;
    if (state.current !== symbol || state.tab !== 'fundamental') return;
    renderFund(f, state.lastData?.symbol === symbol ? state.lastData : null);
    return;
  }
  renderFund(state.fund[symbol], state.lastData?.symbol === symbol ? state.lastData : null);
}

function setTab(tab) {
  state.tab = tab;
  store.set(LS.tab, tab);
  document.querySelectorAll('[data-tab]').forEach((b) => {
    b.classList.toggle('active', b.dataset.tab === tab);
    b.setAttribute('aria-selected', b.dataset.tab === tab);
  });
  document.querySelector('.chart-panel').hidden = tab !== 'teknisk';
  $('fund-panel').hidden = tab !== 'fundamental';
  document.querySelector('main').classList.toggle('fund-view', tab === 'fundamental');
  showFundamentals();
}
document.querySelectorAll('[data-tab]').forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

// ---------- Valg av kjøpssignal ----------
function setStrategy(name, persist = true) {
  if (!STRATEGIES[name]) return;
  const changed = name !== state.strategy || !view;
  state.strategy = name;
  store.set(LS.strategy, name);
  document.querySelectorAll('[data-strategy]').forEach((b) => b.classList.toggle('active', b.dataset.strategy === name));
  if (persist) fetch('/api/settings', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ strategy: name }) }).catch(() => {});
  if (!changed) return;
  buildChart();
  redraw(true);
  state.statuses = {};
  if (state.filter) setFilter(null);
  renderList();
  renderDonut();
}
document.querySelectorAll('[data-strategy]').forEach((b) => b.addEventListener('click', () => {
  if (b.dataset.strategy === state.strategy) return;
  setStrategy(b.dataset.strategy);
  refreshStatuses();
}));

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 401) { location.href = `/login?neste=/${location.hash}`; throw new Error('Ikke innlogget'); }
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

async function select(symbol) {
  state.current = symbol;
  if (decodeURIComponent(location.hash.slice(1)) !== symbol) history.replaceState(null, '', '#' + encodeURIComponent(symbol));
  renderList();
  $('w-sym').textContent = short(symbol);
  $('w-input').value = state.weights[symbol] ?? '';
  const el = $('chart');
  el.querySelector('.msg')?.remove();
  showFundamentals();
  try {
    const data = await api(`/api/chart?symbol=${encodeURIComponent(symbol)}&interval=${state.interval}`);
    if (state.current !== symbol) return;
    state.lastData = data;
    redraw(true);
    showCompany(data);
    document.title = `${short(data.symbol)} · Skyvakt`;
  } catch (e) {
    el.insertAdjacentHTML('beforeend', `<div class="msg">Kunne ikke hente ${esc(symbol)}: ${esc(e.message)}</div>`);
  }
}

// ---------- Kart over hovedkontoret ----------
let mapLib, map, marker;
function loadMapLibre() {
  if (mapLib) return mapLib;
  const link = document.createElement('link');
  link.rel = 'stylesheet';
  link.href = 'vendor/maplibre/maplibre-gl.css';
  document.head.append(link);
  mapLib = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'vendor/maplibre/maplibre-gl.js';
    s.onload = () => resolve(window.maplibregl);
    s.onerror = reject;
    document.head.append(s);
  });
  return mapLib;
}

function setMapInteractive(on) {
  for (const h of ['scrollZoom', 'dragPan', 'dragRotate', 'touchZoomRotate', 'doubleClickZoom', 'keyboard', 'boxZoom']) {
    map[h][on ? 'enable' : 'disable']();
  }
  $('map-activate').parentElement.classList.toggle('active', on);
}
$('map-activate').addEventListener('click', () => map && setMapInteractive(true));

async function showCompany(data) {
  const card = $('hq-card');
  const symbol = data.symbol;
  let info;
  try { info = await api(`/api/company?symbol=${encodeURIComponent(symbol)}&name=${encodeURIComponent(data.name)}`); } catch { info = null; }
  if (state.current !== symbol) return;
  // Kartet vises bare for selskaper i Enhetsregisteret.
  if (!info?.found || !info.point) { card.hidden = true; return; }
  card.hidden = false;
  $('hq-text').innerHTML = `${esc(info.name)} · org.nr. <a href="https://virksomhet.brreg.no/nb/oppslag/enheter/${esc(info.orgnr)}" target="_blank" rel="noopener">${esc(info.orgnr)}</a><br>${esc(info.address)}${info.exact ? '' : ' (omtrentlig plassering)'}`;
  const maplibregl = await loadMapLibre();
  const center = [info.point.lon, info.point.lat];
  if (!map) {
    map = new maplibregl.Map({
      container: 'map',
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center, zoom: 14, attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.FullscreenControl(), 'top-right');
    marker = new maplibregl.Marker({ color: '#d6342c' }).setLngLat(center).addTo(map);
    // Kartet tar ikke over scrollingen før det er aktivert, og låses igjen når musa forlater det.
    setMapInteractive(false);
    $('map').parentElement.addEventListener('mouseleave', () => { if (!document.fullscreenElement) setMapInteractive(false); });
    document.addEventListener('fullscreenchange', () => { if (document.fullscreenElement) setMapInteractive(true); });
  } else {
    marker.setLngLat(center);
    map.jumpTo({ center, zoom: 14 });
    map.resize();
  }
  marker.setPopup(new maplibregl.Popup({ offset: 28, closeButton: false })
    .setHTML(`<b>${esc(info.name)}</b><small>${esc(info.address)}</small>`));
}

// ---------- Watchlist ----------
function save() {
  store.set(LS.list, state.list);
  store.set(LS.weights, state.weights);
  const put = (path, body) => fetch(path, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => {});
  put('/api/watchlist', state.list);
  put('/api/weights', state.weights);
}

function add(symbols, weights = {}) {
  const fresh = symbols.map((s) => s.trim().toUpperCase()).filter((s) => s && !state.list.includes(s));
  for (const [s, w] of Object.entries(weights)) if (state.weights[s] == null) state.weights[s] = w;
  state.list.push(...fresh);
  save();
  renderList();
  renderDonut();
  if (fresh.length) refreshStatuses(fresh);
}

function remove(symbol) {
  state.list = state.list.filter((s) => s !== symbol);
  delete state.statuses[symbol];
  delete state.weights[symbol];
  save();
  renderList();
  renderDonut();
}

function setFilter(sig) {
  state.filter = state.filter === sig ? null : sig;
  const chip = $('filter-chip');
  chip.hidden = !state.filter;
  chip.textContent = state.filter ? S().text[state.filter] : '';
  renderList();
  renderDonut();
}
$('filter-chip').addEventListener('click', () => setFilter(null));

function renderList() {
  const ul = $('watchlist');
  const order = Object.fromEntries(SIGNALS.map((s, i) => [s, i]));
  const items = state.list
    .filter((s) => !state.filter || state.statuses[s]?.signal === state.filter)
    .sort((x, y) => (order[state.statuses[x]?.signal] ?? 9) - (order[state.statuses[y]?.signal] ?? 9));
  ul.innerHTML = '';
  for (const s of items) {
    const st = state.statuses[s];
    const li = document.createElement('li');
    li.className = [s === state.current ? 'active' : '', st?.signal ? `sig-${st.signal}` : ''].join(' ');
    const label = !st ? '…' : st.error ? 'Feil' : S().text[st.signal] || '–';
    li.innerHTML = `<span class="dot"></span><div><span class="t">${esc(short(s))}</span><span class="n">${esc(st?.name || '')}</span></div>
      <span class="lbl"${st?.error ? ` title="${esc(st.error)}"` : ''}>${label}</span><button class="rm" title="Fjern">×</button>`;
    li.addEventListener('click', () => select(s));
    li.querySelector('.rm').addEventListener('click', (e) => { e.stopPropagation(); remove(s); });
    ul.append(li);
  }
}

async function refreshStatuses(symbols = state.list) {
  const strategy = state.strategy;
  for (let i = 0; i < symbols.length; i += 20) {
    const batch = symbols.slice(i, i + 20);
    let res;
    try {
      res = await api(`/api/scan?symbols=${batch.map(encodeURIComponent).join(',')}&strategy=${strategy}`);
    } catch (e) {
      res = Object.fromEntries(batch.map((s) => [s, { error: e.message }]));
    }
    if (strategy !== state.strategy) return; // byttet strategi underveis
    Object.assign(state.statuses, res);
    renderList();
    renderDonut();
  }
}

// ---------- Kakediagram ----------
function arc(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => `${cx + r * Math.sin(a)} ${cy - r * Math.cos(a)}`;
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${p(r1, a0)} A${r1} ${r1} 0 ${large} 1 ${p(r1, a1)} L${p(r0, a1)} A${r0} ${r0} 0 ${large} 0 ${p(r0, a0)}Z`;
}

function renderDonut() {
  const byWeight = state.donutMode === 'weight';
  const groups = SIGNALS.map((sig) => {
    const syms = state.list.filter((s) => state.statuses[s]?.signal === sig);
    const value = byWeight ? syms.reduce((t, s) => t + (+state.weights[s] || 0), 0) : syms.length;
    return { sig, syms, value };
  });
  const total = groups.reduce((t, g) => t + g.value, 0);
  const svg = $('donut');
  if (!total) {
    svg.innerHTML = `<circle cx="100" cy="100" r="74" fill="none" stroke="var(--surface-2)" stroke-width="26"/>
      <text x="100" y="104" text-anchor="middle" class="small">${byWeight ? 'Legg inn vekter' : 'Ingen data ennå'}</text>`;
  } else {
    let a = 0;
    const gap = groups.filter((g) => g.value).length > 1 ? 0.012 : 0;
    const paths = groups.filter((g) => g.value).map((g) => {
      const a1 = a + (g.value / total) * Math.PI * 2;
      const d = g.value === total ? arc(100, 100, 61, 87, 0, Math.PI * 2 - 1e-4) : arc(100, 100, 61, 87, a + gap, a1 - gap);
      a = a1;
      return `<path d="${d}" fill="var(--s-${g.sig})" data-sig="${g.sig}" class="${state.filter === g.sig ? 'hover' : ''}"/>`;
    }).join('');
    const buy = groups.filter((g) => g.sig === 'sterk' || g.sig === 'svak').reduce((t, g) => t + g.value, 0);
    svg.innerHTML = `${paths}
      <text x="100" y="100" text-anchor="middle" class="big">${Math.round((buy / total) * 100)} %</text>
      <text x="100" y="121" text-anchor="middle" class="small">${byWeight ? 'av vekten' : 'av aksjene'}</text>
      <text x="100" y="135" text-anchor="middle" class="small">har kjøpssignal</text>`;
  }
  svg.classList.toggle('has-hover', !!state.filter);
  $('donut-legend').innerHTML = groups.map((g) => {
    const v = byWeight ? `${Math.round(g.value)} %` : g.value;
    return `<li data-sig="${g.sig}" class="sig-${g.sig}${state.filter === g.sig ? ' on' : ''}"><span class="sw"></span><span>${S().text[g.sig]}</span><span class="v">${v}</span></li>`;
  }).join('');
  state.donutGroups = groups;
}

const tip = $('donut-tip');
$('donut').addEventListener('mousemove', (e) => {
  const sig = e.target.dataset?.sig;
  if (!sig) { tip.hidden = true; return; }
  const g = state.donutGroups.find((x) => x.sig === sig);
  const wrap = $('donut').parentElement.getBoundingClientRect();
  tip.hidden = false;
  tip.style.left = `${e.clientX - wrap.left}px`;
  tip.style.top = `${e.clientY - wrap.top}px`;
  tip.textContent = `${S().text[sig]}: ${g.syms.map(short).join(', ')}`;
});
$('donut').addEventListener('mouseleave', () => { tip.hidden = true; });
$('donut').addEventListener('click', (e) => { if (e.target.dataset?.sig) setFilter(e.target.dataset.sig); });
$('donut-legend').addEventListener('click', (e) => { const li = e.target.closest('li'); if (li) setFilter(li.dataset.sig); });
document.querySelectorAll('[data-mode]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-mode]').forEach((x) => x.classList.toggle('active', x === b));
  state.donutMode = b.dataset.mode;
  renderDonut();
}));
$('w-input').addEventListener('change', (e) => {
  if (!state.current) return;
  const v = parseFloat(e.target.value);
  if (Number.isFinite(v) && v > 0) state.weights[state.current] = v; else delete state.weights[state.current];
  save();
  renderDonut();
});

// ---------- Søk ----------
let searchTimer, suggestions = [], sel = -1;
function renderSuggestions() {
  const ul = $('suggestions');
  ul.hidden = !suggestions.length;
  ul.innerHTML = suggestions.map((x, i) =>
    `<li class="${i === sel ? 'sel' : ''}" data-i="${i}"><span><b>${esc(x.symbol)}</b> ${esc(x.name)}</span><small>${esc(x.exchange || '')}</small></li>`).join('');
}
function pick(symbol) {
  add([symbol]);
  select(symbol.toUpperCase());
  $('search').value = ''; suggestions = []; renderSuggestions();
}
$('search').addEventListener('input', (e) => {
  clearTimeout(searchTimer);
  const q = e.target.value.trim();
  if (q.length < 2) { suggestions = []; renderSuggestions(); return; }
  searchTimer = setTimeout(async () => {
    try { suggestions = await api(`/api/search?q=${encodeURIComponent(q)}`); } catch { suggestions = []; }
    sel = -1;
    renderSuggestions();
  }, 250);
});
$('search').addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, suggestions.length - 1); renderSuggestions(); e.preventDefault(); }
  else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); renderSuggestions(); e.preventDefault(); }
  else if (e.key === 'Enter') { const s = suggestions[sel]?.symbol || e.target.value.trim(); if (s) pick(s); }
  else if (e.key === 'Escape') { suggestions = []; renderSuggestions(); }
});
$('suggestions').addEventListener('mousedown', (e) => {
  const li = e.target.closest('li');
  if (li) pick(suggestions[+li.dataset.i].symbol);
});

// ---------- Kontroller ----------
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => {
  add(PRESETS[b.dataset.preset], b.dataset.preset === 'evighet' ? PRESET_WEIGHTS : {});
}));
document.querySelectorAll('[data-interval]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-interval]').forEach((x) => x.classList.toggle('active', x === b));
  state.interval = b.dataset.interval;
  if (state.current) select(state.current);
}));
$('refresh').addEventListener('click', () => refreshStatuses());
window.addEventListener('hashchange', () => {
  const s = decodeURIComponent(location.hash.slice(1));
  if (s && s !== state.current) select(s);
});

// ---------- Oppstart ----------
(async function init() {
  // Strategien lagres på serveren, så varslene og alle maskiner følger samme valg.
  try {
    const s = await api('/api/settings');
    if (STRATEGIES[s.strategy]) state.strategy = s.strategy;
  } catch {}
  setStrategy(state.strategy, false);
  setTab(state.tab);
  let list = [];
  try { list = await api('/api/watchlist'); } catch {}
  try { Object.assign(state.weights, await api('/api/weights')); } catch {}
  if (!list.length) list = store.get(LS.list, []);
  if (!list.length) { list = [...PRESETS.evighet]; Object.assign(state.weights, PRESET_WEIGHTS); }
  state.list = list;
  save();
  renderList();
  renderDonut();
  select(decodeURIComponent(location.hash.slice(1)) || state.list[0]);
  refreshStatuses();
})();
