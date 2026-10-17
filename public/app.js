import {
  createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries, CrosshairMode,
} from './vendor/lightweight-charts.standalone.production.mjs';
import { analyze, SIGNAL_TEXT, DEFAULTS } from './ichimoku.js';

const PRESETS = {
  evighet: ['EQNR', 'DNB', 'KOG', 'KMAR', 'NHY', 'MOWI', 'TEL', 'GJF'].map((s) => s + '.OL'),
  obx: ['EQNR', 'DNB', 'AKRBP', 'TEL', 'MOWI', 'NHY', 'YAR', 'ORK', 'KOG', 'GJF', 'STB', 'SALM', 'SUBC',
    'TGS', 'FRO', 'VAR', 'NOD', 'AKER', 'BAKKA', 'SCATC', 'HAFNI', 'MPCC', 'AUTO', 'NAS', 'WAWI'].map((s) => s + '.OL'),
  nasdaq: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'COST', 'NFLX', 'AMD', 'ADBE'],
};
const LS_KEY = 'ichimoku.watchlist';

const $ = (id) => document.getElementById(id);
const state = { list: [], statuses: {}, current: null, interval: '1d', onlyBuy: false };

// ---------- Graf ----------
const chart = createChart($('chart'), {
  autoSize: true,
  layout: { background: { color: '#131722' }, textColor: '#d1d4dc', panes: { separatorColor: '#2a2e39' } },
  grid: { vertLines: { color: '#1e222d' }, horzLines: { color: '#1e222d' } },
  crosshair: { mode: CrosshairMode.Normal },
  rightPriceScale: { borderColor: '#2a2e39' },
  timeScale: { borderColor: '#2a2e39', rightOffset: 4 },
  localization: { locale: 'nb-NO' },
});
const candles = chart.addSeries(CandlestickSeries, {
  upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350',
});
const line = (color, width = 1) => chart.addSeries(LineSeries, {
  color, lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
});
const spanB = line('#ef5350');
const spanA = line('#26a69a');
const tenkan = line('#2962ff');
const kijun = line('#e91e63', 2);
const chikou = line('#ab47bc');
const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 1);
chart.panes()[1]?.setHeight(90);
const markers = createSeriesMarkers(candles, []);

// Fyller skyen mellom Senkou A og B: grønn når A > B, rød ellers.
class CloudFill {
  constructor() { this.points = []; }
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
              ctx.fillStyle = p1.up ? 'rgba(38,166,154,0.18)' : 'rgba(239,83,80,0.18)';
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
const cloud = new CloudFill();
spanA.attachPrimitive(cloud);

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

function draw(data) {
  const c = data.candles;
  const { ich, events, status } = analyze(c);
  const shift = DEFAULTS.shift;
  const future = futureTimes(c[c.length - 1].time, shift, state.interval);
  const timeAt = (i) => (i < c.length ? c[i].time : future[i - c.length]);
  const pts = (arr, offset = 0) => arr.map((v, i) => (v == null ? null : { time: timeAt(i + offset), value: v }))
    .filter((p) => p && p.time);

  candles.setData(c.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  volume.setData(c.map((x) => ({ time: x.time, value: x.volume, color: x.close >= x.open ? 'rgba(38,166,154,.45)' : 'rgba(239,83,80,.45)' })));
  tenkan.setData(pts(ich.tenkan));
  kijun.setData(pts(ich.kijun));
  chikou.setData(c.slice(shift).map((x, i) => ({ time: c[i].time, value: x.close })));
  const a = pts(ich.futureA, shift), b = pts(ich.futureB, shift);
  spanA.setData(a);
  spanB.setData(b);
  const bByTime = new Map(b.map((p) => [p.time, p.value]));
  cloud.setPoints(a.filter((p) => bByTime.has(p.time)).map((p) => ({ time: p.time, a: p.value, b: bByTime.get(p.time) })));

  markers.setMarkers(events.map((e) => e.type === 'sterk'
    ? { time: e.time, position: 'belowBar', color: '#26a69a', shape: 'arrowUp', text: 'Kjøp' }
    : { time: e.time, position: 'belowBar', color: '#787b86', shape: 'arrowUp', size: 0.6 }));

  const visible = (state.interval === '1wk' ? 156 : 180) / (innerWidth < 760 ? 2 : 1);
  chart.timeScale().setVisibleLogicalRange({ from: c.length - visible, to: c.length + shift });
  return status;
}

// ---------- Info-panel ----------
function fmt(n) { return n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 }); }

function showInfo(data, status) {
  const c = data.candles;
  const last = c[c.length - 1], prev = c[c.length - 2];
  $('sym').textContent = data.symbol;
  $('name').textContent = `${data.name} · ${data.exchange || ''}`;
  $('last').textContent = `${fmt(last.close)} ${data.currency || ''}`;
  const pct = prev ? (last.close / prev.close - 1) * 100 : 0;
  $('chg').textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(2)} %`;
  $('chg').className = pct >= 0 ? 'up' : 'down';
  const sig = $('signal');
  const k = status?.conditions;
  if (!status) { sig.className = 'badge err'; sig.textContent = 'For lite historikk'; $('conditions').innerHTML = ''; return; }
  sig.className = `badge ${status.signal}`;
  sig.textContent = `${SIGNAL_TEXT[status.signal]} · ${status.score}/4`;
  const per = state.interval === '1wk' ? 'uker' : 'dager';
  $('conditions').innerHTML = [
    [k.aboveCloud, 'Kurs over skyen'],
    [k.tkCross, `Tenkan krysset over Kijun siste ${DEFAULTS.tkLookback} ${per}`],
    [k.chikouAbove, 'Chikou over kursen for 26 perioder siden'],
    [k.futureGreen, 'Grønn sky fremover'],
  ].map(([ok, t]) => `<li class="${ok ? 'ok' : 'no'}">${t}</li>`).join('');
}

async function api(path, opts) {
  const res = await fetch(path, opts);
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

async function select(symbol) {
  state.current = symbol;
  location.hash = encodeURIComponent(symbol);
  renderList();
  const el = $('chart');
  el.querySelector('.msg')?.remove();
  try {
    const data = await api(`/api/chart?symbol=${encodeURIComponent(symbol)}&interval=${state.interval}`);
    if (state.current !== symbol) return;
    const status = draw(data);
    showInfo(data, status);
    document.title = `${data.symbol} · Ichimoku`;
  } catch (e) {
    el.insertAdjacentHTML('beforeend', `<div class="msg">Kunne ikke hente ${symbol}: ${e.message}</div>`);
  }
}

// ---------- Watchlist ----------
function save() {
  try { localStorage.setItem(LS_KEY, JSON.stringify(state.list)); } catch {}
  fetch('/api/watchlist', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state.list) }).catch(() => {});
}

function add(symbols) {
  const fresh = symbols.map((s) => s.trim().toUpperCase()).filter((s) => s && !state.list.includes(s));
  if (!fresh.length) return;
  state.list.push(...fresh);
  save();
  renderList();
  refreshStatuses(fresh);
}

function remove(symbol) {
  state.list = state.list.filter((s) => s !== symbol);
  delete state.statuses[symbol];
  save();
  renderList();
}

function renderList() {
  const ul = $('watchlist');
  const order = { sterk: 0, svak: 1, over: 2, noytral: 3, under: 4 };
  const items = state.list
    .filter((s) => !state.onlyBuy || ['sterk', 'svak'].includes(state.statuses[s]?.signal))
    .sort((x, y) => (order[state.statuses[x]?.signal] ?? 9) - (order[state.statuses[y]?.signal] ?? 9));
  ul.innerHTML = '';
  for (const s of items) {
    const st = state.statuses[s];
    const li = document.createElement('li');
    if (s === state.current) li.className = 'active';
    const badge = !st ? '<span class="badge noytral">…</span>'
      : st.error ? '<span class="badge err" title="' + st.error.replace(/"/g, '') + '">Feil</span>'
      : `<span class="badge ${st.signal}">${SIGNAL_TEXT[st.signal] || '–'}</span>`;
    li.innerHTML = `<div><span class="t">${s}</span><span class="n">${st?.name || ''}</span></div>${badge}<button class="rm" title="Fjern">×</button>`;
    li.addEventListener('click', () => select(s));
    li.querySelector('.rm').addEventListener('click', (e) => { e.stopPropagation(); remove(s); });
    ul.append(li);
  }
}

async function refreshStatuses(symbols = state.list) {
  for (let i = 0; i < symbols.length; i += 20) {
    const batch = symbols.slice(i, i + 20);
    try {
      Object.assign(state.statuses, await api(`/api/scan?symbols=${batch.map(encodeURIComponent).join(',')}`));
    } catch (e) {
      batch.forEach((s) => { state.statuses[s] = { error: e.message }; });
    }
    renderList();
  }
}

// ---------- Søk ----------
let searchTimer, suggestions = [], sel = -1;
function renderSuggestions() {
  const ul = $('suggestions');
  ul.hidden = !suggestions.length;
  ul.innerHTML = suggestions.map((x, i) =>
    `<li class="${i === sel ? 'sel' : ''}" data-i="${i}"><span><b>${x.symbol}</b> ${x.name}</span><small>${x.exchange || ''}</small></li>`).join('');
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
  else if (e.key === 'Enter') {
    const pick = suggestions[sel]?.symbol || e.target.value.trim();
    if (pick) { add([pick]); select(pick.toUpperCase()); }
    e.target.value = ''; suggestions = []; renderSuggestions();
  } else if (e.key === 'Escape') { suggestions = []; renderSuggestions(); }
});
$('suggestions').addEventListener('mousedown', (e) => {
  const li = e.target.closest('li');
  if (!li) return;
  const pick = suggestions[+li.dataset.i].symbol;
  add([pick]); select(pick);
  $('search').value = ''; suggestions = []; renderSuggestions();
});

// ---------- Kontroller ----------
document.querySelectorAll('[data-preset]').forEach((b) => b.addEventListener('click', () => add(PRESETS[b.dataset.preset])));
document.querySelectorAll('[data-interval]').forEach((b) => b.addEventListener('click', () => {
  document.querySelectorAll('[data-interval]').forEach((x) => x.classList.toggle('active', x === b));
  state.interval = b.dataset.interval;
  if (state.current) select(state.current);
}));
$('only-buy').addEventListener('change', (e) => { state.onlyBuy = e.target.checked; renderList(); });
$('refresh').addEventListener('click', () => refreshStatuses());
window.addEventListener('hashchange', () => {
  const s = decodeURIComponent(location.hash.slice(1));
  if (s && s !== state.current) select(s);
});

// ---------- Oppstart ----------
(async function init() {
  let list = [];
  try { list = await api('/api/watchlist'); } catch {}
  if (!list.length) { try { list = JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch {} }
  if (!list.length) list = [...PRESETS.evighet];
  state.list = list;
  save();
  renderList();
  const fromHash = decodeURIComponent(location.hash.slice(1));
  select(fromHash || state.list[0]);
  refreshStatuses();
})();
