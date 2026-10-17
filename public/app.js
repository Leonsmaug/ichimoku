import {
  createChart, createSeriesMarkers, CandlestickSeries, HistogramSeries, LineSeries, CrosshairMode, ColorType,
} from './vendor/lightweight-charts.standalone.production.mjs';
import { analyze, backtest, insights, SIGNAL_TEXT, DEFAULTS } from './ichimoku.js';

const PRESETS = {
  evighet: ['EQNR', 'DNB', 'KOG', 'KMAR', 'NHY', 'MOWI', 'TEL', 'GJF'].map((s) => s + '.OL'),
  obx: ['EQNR', 'DNB', 'AKRBP', 'TEL', 'MOWI', 'NHY', 'YAR', 'ORK', 'KOG', 'GJF', 'STB', 'SALM', 'SUBC',
    'TGS', 'FRO', 'VAR', 'NOD', 'AKER', 'BAKKA', 'SCATC', 'HAFNI', 'MPCC', 'AUTO', 'NAS', 'WAWI'].map((s) => s + '.OL'),
  nasdaq: ['AAPL', 'MSFT', 'NVDA', 'AMZN', 'GOOGL', 'META', 'TSLA', 'AVGO', 'COST', 'NFLX', 'AMD', 'ADBE'],
};
const PRESET_WEIGHTS = { 'EQNR.OL': 18, 'DNB.OL': 17, 'KOG.OL': 15, 'KMAR.OL': 10, 'NHY.OL': 10, 'MOWI.OL': 10, 'TEL.OL': 10, 'GJF.OL': 10 };
const SIGNALS = ['sterk', 'svak', 'over', 'noytral', 'under'];
const LS = { list: 'ichimoku.watchlist', weights: 'ichimoku.weights', theme: 'ichimoku.theme' };

const $ = (id) => document.getElementById(id);
const store = {
  get(k, fallback) { try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
};
const state = {
  list: [], statuses: {}, weights: store.get(LS.weights, {}), current: null, interval: '1d',
  filter: null, donutMode: 'count', lastData: null,
};
const css = (name) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const pct = (x, digits = 1) => `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toLocaleString('nb-NO', { maximumFractionDigits: digits, minimumFractionDigits: digits })} %`;
const fmt = (n) => n.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const short = (s) => s.replace(/\.OL$/, '');

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
const chart = createChart($('chart'), {
  autoSize: true,
  crosshair: { mode: CrosshairMode.Normal },
  timeScale: { rightOffset: 4, borderVisible: false },
  rightPriceScale: { borderVisible: false },
  localization: { locale: 'nb-NO' },
});
const candles = chart.addSeries(CandlestickSeries, { borderVisible: false });
const line = (width = 1.5) => chart.addSeries(LineSeries, {
  lineWidth: width, priceLineVisible: false, lastValueVisible: false, crosshairMarkerVisible: false,
});
const spanB = line(1);
const spanA = line(1);
const tenkan = line();
const kijun = line(2);
const chikou = line(1);
const volume = chart.addSeries(HistogramSeries, { priceFormat: { type: 'volume' }, priceLineVisible: false, lastValueVisible: false }, 1);
chart.panes()[1]?.setHeight(80);
const markers = createSeriesMarkers(candles, []);

function rgba(hex, a) {
  const n = parseInt(hex.replace('#', ''), 16);
  return `rgba(${n >> 16}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
}

function applyChartTheme() {
  const up = css('--up'), down = css('--down');
  chart.applyOptions({
    layout: {
      background: { type: ColorType.Solid, color: css('--surface') },
      textColor: css('--muted'),
      fontFamily: 'Inter, sans-serif',
      panes: { separatorColor: css('--line') },
    },
    grid: { vertLines: { color: css('--grid') }, horzLines: { color: css('--grid') } },
  });
  candles.applyOptions({ upColor: up, downColor: down, wickUpColor: up, wickDownColor: down });
  tenkan.applyOptions({ color: css('--tenkan') });
  kijun.applyOptions({ color: css('--kijun') });
  chikou.applyOptions({ color: rgba(css('--chikou'), 0.8) });
  spanA.applyOptions({ color: rgba(up, 0.7) });
  spanB.applyOptions({ color: rgba(down, 0.7) });
  cloud.colors = { up: rgba(up, 0.16), down: rgba(down, 0.14) };
  if (state.lastData) draw(state.lastData, false);
}

// Fyller skyen mellom Senkou A og B: grønn når A > B, rød ellers.
class CloudFill {
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

function draw(data, resetView = true) {
  const c = data.candles;
  const result = analyze(c);
  const { ich, events } = result;
  const shift = DEFAULTS.shift;
  const future = futureTimes(c[c.length - 1].time, shift, state.interval);
  const timeAt = (i) => (i < c.length ? c[i].time : future[i - c.length]);
  const pts = (arr, offset = 0) => arr.map((v, i) => (v == null ? null : { time: timeAt(i + offset), value: v }))
    .filter((p) => p && p.time);
  const up = css('--up'), down = css('--down');

  candles.setData(c.map(({ time, open, high, low, close }) => ({ time, open, high, low, close })));
  volume.setData(c.map((x) => ({ time: x.time, value: x.volume, color: rgba(x.close >= x.open ? up : down, 0.35) })));
  tenkan.setData(pts(ich.tenkan));
  kijun.setData(pts(ich.kijun));
  chikou.setData(c.slice(shift).map((x, i) => ({ time: c[i].time, value: x.close })));
  const a = pts(ich.futureA, shift), b = pts(ich.futureB, shift);
  spanA.setData(a);
  spanB.setData(b);
  const bByTime = new Map(b.map((p) => [p.time, p.value]));
  cloud.setPoints(a.filter((p) => bByTime.has(p.time)).map((p) => ({ time: p.time, a: p.value, b: bByTime.get(p.time) })));
  markers.setMarkers(events.filter((e) => e.type === 'sterk')
    .map((e) => ({ time: e.time, position: 'belowBar', color: css('--s-sterk'), shape: 'arrowUp', text: 'Kjøp' })));

  if (resetView) {
    const visible = (state.interval === '1wk' ? 156 : 180) / (innerWidth < 760 ? 2 : 1);
    chart.timeScale().setVisibleLogicalRange({ from: c.length - visible, to: c.length + shift });
  }
  return result;
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
  sig.textContent = status ? `${SIGNAL_TEXT[status.signal]} · ${status.score}/4` : 'For lite historikk';
}

// Skriver en kort lesning av grafen på vanlig norsk.
function story(sym, status, ins) {
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

function showInsight(data, result) {
  const { status } = result;
  const ins = insights(data.candles, result);
  const per = state.interval === '1wk' ? 'uker' : 'dager';
  if (!status || !ins) {
    $('story').textContent = 'For lite historikk til å regne ut skyen.';
    $('conditions').innerHTML = '';
    ['m-dist', 'm-twist', 'm-since'].forEach((id) => { $(id).textContent = '–'; });
    $('backtest').innerHTML = '';
    return;
  }
  $('story').innerHTML = story(short(data.symbol), status, ins);
  const k = status.conditions;
  $('conditions').innerHTML = [
    [k.aboveCloud, 'Kurs over skyen'],
    [k.tkCross, `Tenkan krysset over Kijun siste ${DEFAULTS.tkLookback} ${per}`],
    [k.chikouAbove, 'Chikou over kursen for 26 perioder siden'],
    [k.futureGreen, 'Grønn sky fremover'],
  ].map(([ok, t]) => `<li class="${ok ? 'ok' : 'no'}">${t}</li>`).join('');
  $('m-dist').textContent = ins.distance === 0 ? 'I skyen' : pct(ins.distance);
  const unit = state.interval === '1wk' ? 'u' : 'd';
  $('m-twist').textContent = ins.twistIn == null ? 'Ingen' : `${ins.twistIn} ${unit}`;
  $('m-since').textContent = ins.sinceStrong == null ? 'Aldri' : `${ins.sinceStrong} ${unit}`;

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
  try {
    const data = await api(`/api/chart?symbol=${encodeURIComponent(symbol)}&interval=${state.interval}`);
    if (state.current !== symbol) return;
    state.lastData = data;
    const result = draw(data);
    showHeader(data, result.status);
    showInsight(data, result);
    showCompany(data);
    document.title = `${short(data.symbol)} · Skyvakt`;
  } catch (e) {
    el.insertAdjacentHTML('beforeend', `<div class="msg">Kunne ikke hente ${symbol}: ${e.message}</div>`);
  }
}

// ---------- Kart over hovedkontoret ----------
let mapLib, map, marker;
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
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
  chip.textContent = state.filter ? SIGNAL_TEXT[state.filter] : '';
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
    const label = !st ? '…' : st.error ? 'Feil' : SIGNAL_TEXT[st.signal] || '–';
    li.innerHTML = `<span class="dot"></span><div><span class="t">${short(s)}</span><span class="n">${st?.name || ''}</span></div>
      <span class="lbl"${st?.error ? ` title="${st.error.replace(/"/g, '')}"` : ''}>${label}</span><button class="rm" title="Fjern">×</button>`;
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
    return `<li data-sig="${g.sig}" class="sig-${g.sig}${state.filter === g.sig ? ' on' : ''}"><span class="sw"></span><span>${SIGNAL_TEXT[g.sig]}</span><span class="v">${v}</span></li>`;
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
  tip.textContent = `${SIGNAL_TEXT[sig]}: ${g.syms.map(short).join(', ')}`;
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
    `<li class="${i === sel ? 'sel' : ''}" data-i="${i}"><span><b>${x.symbol}</b> ${x.name}</span><small>${x.exchange || ''}</small></li>`).join('');
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
  applyChartTheme();
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
