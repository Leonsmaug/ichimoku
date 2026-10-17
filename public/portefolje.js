// Nn-portefølje: Nordnet-beholdningen med live kurser, gevinst og fordeling etter sektor.

const SECTORS = [
  ['energi', 'Energi', '#b6f7a5'],
  ['materialer', 'Materialer', '#b9f5cf'],
  ['industri', 'Industri', '#8ff9fd'],
  ['transport', 'Transport', '#84c9f6'],
  ['konsum', 'Konsum', '#d0cdf6'],
  ['finans', 'Finans', '#f1a1f6'],
  ['teknologi', 'Teknologi', '#f0a6a1'],
  ['telekom', 'Telekom', '#f2a473'],
  ['forbruksvarer', 'Forbruksvarer', '#fdf57f'],
  ['helse', 'Helse', '#e6e6e6'],
  ['forsyning', 'Forsyning', '#d7ef8a'],
  ['eiendom', 'Eiendom', '#e8d5b5'],
  ['fond', 'Fond og ETF', '#aab7c8'],
  ['krypto', 'Krypto', '#b08968'],
  ['annet', 'Annet', '#c8c2b4'],
  ['kontanter', 'Kontanter', '#7d8a96'],
];
const SECTOR = Object.fromEntries(SECTORS.map(([k, label, color], i) => [k, { k, label, color, i }]));
const $ = (id) => document.getElementById(id);
const esc = (t) => String(t).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const kr = (x) => `${Math.round(x).toLocaleString('nb-NO')} kr`;
const signed = (x) => `${x >= 0 ? '+' : '−'}${Math.abs(Math.round(x)).toLocaleString('nb-NO')} kr`;
const pct = (x, d = 1) => (x == null || !Number.isFinite(x) ? '–' : `${x >= 0 ? '+' : '−'}${Math.abs(x * 100).toLocaleString('nb-NO', { minimumFractionDigits: d, maximumFractionDigits: d })} %`);
const share = (x) => `${(x * 100).toLocaleString('nb-NO', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} %`;
const price = (x) => x.toLocaleString('nb-NO', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const cls = (x) => (x > 0 ? 'pos' : x < 0 ? 'neg' : '');

const state = { pf: null, quotes: {}, fx: {}, account: 'alle', scope: 'alt', sort: { key: 'value', dir: -1 }, updated: null, rows: [] };

async function api(path, opts) {
  const res = await fetch(path, opts);
  if (res.status === 401) { location.href = '/login?neste=/portefolje'; throw new Error('Ikke innlogget'); }
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || res.statusText);
  return body;
}

// ---------- Tema ----------
$('theme').addEventListener('click', () => {
  const t = document.documentElement.dataset.theme;
  const dark = t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
  document.documentElement.dataset.theme = dark ? 'light' : 'dark';
  try { localStorage.setItem('ichimoku.theme', dark ? 'light' : 'dark'); } catch {}
});

// ---------- Beregning ----------
function savePortfolio() {
  return api('/api/portfolio', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(state.pf) }).catch(() => {});
}

// Kursen i rapporten skal stemme med Yahoo før vi bruker tickeren (fanger feil papir eller pence/øre).
function liveQuote(h) {
  const q = h.ticker && state.quotes[h.ticker];
  if (!q || q.error || q.currency !== h.currency) return null;
  if (!h.verified && h.reportPrice && Math.abs(q.price / h.reportPrice - 1) > 0.5) return null;
  return q;
}

function compute() {
  const rows = [];
  let changed = false;
  for (const a of state.pf.accounts) {
    for (const h of a.holdings) {
      const q = liveQuote(h);
      if (q && !h.verified) { h.verified = true; changed = true; }
      const fx = h.currency === 'NOK' ? { price: 1, prev: 1 } : state.fx[h.currency];
      const fxReport = h.qty && h.reportPrice ? h.valueNok / (h.qty * h.reportPrice) : 1;
      let value = h.valueNok, day = 0, last = h.reportPrice;
      if (q && fx?.price) {
        value = h.qty * q.price * fx.price;
        last = q.price;
        if (q.prev) day = value - h.qty * q.prev * (fx.prev || fx.price);
      } else if (fx?.price && h.currency !== 'NOK') {
        value = h.valueNok * (fx.price / fxReport);
      }
      const cost = h.valueNok - h.resultNok;
      rows.push({
        account: a.name, h, live: !!q, sector: h.sector && SECTOR[h.sector] ? h.sector : (h.type === 'aksje' ? 'annet' : 'fond'),
        name: h.name, ticker: h.ticker, qty: h.qty, currency: h.currency, last, value, day, cost, gain: value - cost,
        reportValue: h.valueNok,
      });
    }
    rows.push({ account: a.name, cash: true, sector: 'kontanter', name: 'Kontanter', value: a.cash, day: 0, cost: a.cash, gain: 0, reportValue: a.cash });
  }
  if (changed) savePortfolio();
  state.rows = rows;
}

const inScope = (r) => (state.account === 'alle' || r.account === state.account);
const sum = (rows, k) => rows.reduce((t, r) => t + (r[k] || 0), 0);

// ---------- Visning ----------
function renderStats() {
  const rows = state.rows.filter(inScope);
  const value = sum(rows, 'value'), day = sum(rows, 'day');
  const invested = rows.filter((r) => !r.cash);
  const gain = sum(invested, 'gain'), cost = sum(invested, 'cost');
  const since = value - sum(rows, 'reportValue');
  const cash = sum(rows.filter((r) => r.cash), 'value');
  const tile = (label, big, small, c = '') => `<div class="panel pf-stat"><small>${label}</small><b class="${c}">${big}</b><span class="${c}">${small}</span></div>`;
  $('pf-stats').innerHTML = [
    tile(state.account === 'alle' ? 'Totalt i Nordnet' : esc(state.account), kr(value), `${invested.length} posisjoner`),
    tile('I dag', signed(day), pct(value - day ? day / (value - day) : 0, 2), cls(day)),
    tile('Urealisert gevinst', signed(gain), `${pct(cost ? gain / cost : null)} på ${kr(cost)}`, cls(gain)),
    tile(`Siden rapporten ${formatDate(state.pf.asOf)}`, signed(since), pct(value - since ? since / (value - since) : 0, 2), cls(since)),
    tile('Kontanter', kr(cash), `${share(value ? cash / value : 0)} av verdien`),
  ].join('');
}

function formatDate(d) {
  if (!d) return '';
  const [y, m, dd] = d.split('-');
  return `${+dd}.${+m}.${y}`;
}

function renderChips() {
  const names = ['alle', ...state.pf.accounts.map((a) => a.name)];
  $('pf-chips').innerHTML = names.map((n) => `<button data-account="${esc(n)}" class="${n === state.account ? 'active' : ''}">${n === 'alle' ? 'Hele Nordnet' : esc(n)}</button>`).join('');
}
$('pf-chips').addEventListener('click', (e) => {
  const b = e.target.closest('[data-account]');
  if (b) setAccount(b.dataset.account);
});
document.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => {
  state.scope = b.dataset.scope;
  document.querySelectorAll('[data-scope]').forEach((x) => x.classList.toggle('active', x === b));
  renderDist();
}));

function setAccount(name) {
  state.account = name;
  renderAll();
}

// Slår sammen samme papir på tvers av kontoer.
function merged(rows) {
  const map = new Map();
  for (const r of rows) {
    const key = r.cash ? 'cash' : r.ticker || r.name;
    const m = map.get(key);
    if (!m) map.set(key, { ...r, accounts: [r.account] });
    else {
      for (const k of ['value', 'day', 'cost', 'gain', 'reportValue']) m[k] += r[k];
      m.qty = (m.qty || 0) + (r.qty || 0);
      m.accounts.push(r.account);
      m.live = m.live && r.live;
    }
  }
  return [...map.values()];
}

// ---------- Sektordiagram (sunburst) ----------
const CX = 450, CY = 320, R0 = 158, R1 = 236;
function polar(r, a) { return [CX + r * Math.sin(a), CY - r * Math.cos(a)]; }
function wedge(r0, r1, a0, a1) {
  const large = a1 - a0 > Math.PI ? 1 : 0;
  const [x1, y1] = polar(r1, a0), [x2, y2] = polar(r1, a1);
  if (r0 === 0) return `M${CX} ${CY} L${x1} ${y1} A${r1} ${r1} 0 ${large} 1 ${x2} ${y2} Z`;
  const [x3, y3] = polar(r0, a1), [x4, y4] = polar(r0, a0);
  return `M${x1} ${y1} A${r1} ${r1} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${r0} ${r0} 0 ${large} 0 ${x4} ${y4} Z`;
}
function ink(hex) {
  const n = parseInt(hex.slice(1), 16);
  const l = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255;
  return l > 0.6 ? '#1f1e1c' : '#ffffff';
}

function distRows() {
  let rows = merged(state.rows.filter(inScope)).filter((r) => r.value > 0);
  if (state.scope === 'aksjer') rows = rows.filter((r) => !r.cash && r.h?.type === 'aksje');
  return rows;
}

function renderDist() {
  const rows = distRows();
  const total = sum(rows, 'value');
  const groups = SECTORS.map(([k]) => {
    const items = rows.filter((r) => r.sector === k).sort((a, b) => b.value - a.value);
    return { s: SECTOR[k], items, value: sum(items, 'value') };
  }).filter((g) => g.value > 0);
  const svg = $('sunburst');
  $('pf-dist-title').textContent = `Fordeling · ${state.account === 'alle' ? 'hele Nordnet' : state.account}`;
  if (!total) { svg.innerHTML = ''; $('pf-sectors').innerHTML = ''; return; }
  let a = 0, out = '', labels = '';
  const outer = [];
  state.sunItems = [];
  for (const g of groups) {
    const a0 = a, a1 = a + (g.value / total) * Math.PI * 2;
    const full = groups.length === 1;
    out += `<path d="${full ? wedge(0, R0, 0, Math.PI * 2 - 1e-4) : wedge(0, R0, a0, a1)}" fill="${g.s.color}" data-i="${state.sunItems.length}"/>`;
    state.sunItems.push({ title: g.s.label, value: g.value, total, gain: sum(g.items, 'gain'), n: g.items.length });
    // Sektornavn langs radien, slik at teksten står ut fra midten.
    if (a1 - a0 > 0.2) {
      const mid = (a0 + a1) / 2;
      const [x, y] = polar(R0 * 0.6, mid);
      let rot = (mid * 180) / Math.PI - 90;
      if (rot > 90) rot -= 180;
      labels += `<text x="${x}" y="${y}" transform="rotate(${rot} ${x} ${y})" text-anchor="middle" dominant-baseline="middle" class="sun-in" fill="${ink(g.s.color)}">${g.s.label} ${share(g.value / total)}</text>`;
    }
    let b = a0;
    for (const r of g.items) {
      const b1 = b + (r.value / total) * Math.PI * 2;
      out += `<path d="${full && g.items.length === 1 ? wedge(R0 + 3, R1, 0, Math.PI * 2 - 1e-4) : wedge(R0 + 3, R1, b, b1)}" fill="${g.s.color}" data-i="${state.sunItems.length}"/>`;
      state.sunItems.push({ title: r.name, value: r.value, total, gain: r.gain, cost: r.cost, cash: r.cash, sector: g.s.label });
      if (r.value / total >= 0.012) {
        const mid = (b + b1) / 2;
        const [x, y] = polar(R1 + 10, mid);
        outer.push({ x, y, right: Math.sin(mid) >= 0, name: r.name.length > 26 ? r.name.slice(0, 25) + '…' : r.name });
      }
      b = b1;
    }
    a = a1;
  }
  // Skyv navnene fra hverandre på hver side, så de ikke overlapper.
  for (const right of [true, false]) {
    const side = outer.filter((l) => l.right === right).sort((p, q) => p.y - q.y);
    for (let i = 1; i < side.length; i++) side[i].y = Math.max(side[i].y, side[i - 1].y + 15);
    for (const l of side) {
      labels += `<text x="${l.x}" y="${l.y}" text-anchor="${right ? 'start' : 'end'}" dominant-baseline="middle" class="sun-out">${esc(l.name)}</text>`;
    }
  }
  // Uten navn rundt (mobil) trengs ikke margen til tekst, så diagrammet kan bli større.
  svg.setAttribute('viewBox', matchMedia('(max-width: 860px)').matches ? `${CX - R1 - 6} ${CY - R1 - 6} ${2 * R1 + 12} ${2 * R1 + 12}` : '0 0 900 660');
  svg.innerHTML = `<g class="sun-slices">${out}</g>${labels}`;
  $('pf-sectors').innerHTML = `<thead><tr><th>Sektor</th><th>Andel</th><th>Verdi</th></tr></thead><tbody>${groups.map((g) => `
    <tr><td><span class="sw" style="background:${g.s.color}"></span>${g.s.label}</td><td>${share(g.value / total)}</td><td>${kr(g.value)}</td></tr>`).join('')}</tbody>`;
}

const tip = $('sun-tip');
function showTip(e) {
  const i = e.target.dataset?.i;
  if (i == null) { tip.hidden = true; return; }
  const it = state.sunItems[+i];
  const wrap = $('sunburst').parentElement.getBoundingClientRect();
  tip.hidden = false;
  // Hold boblen innenfor kanten på smale skjermer.
  const half = Math.min(120, wrap.width / 2);
  tip.style.left = `${Math.min(Math.max(e.clientX - wrap.left, half), wrap.width - half)}px`;
  tip.style.top = `${e.clientY - wrap.top}px`;
  const g = it.cash ? '' : ` · gevinst ${signed(it.gain)}`;
  tip.textContent = `${it.title}${it.sector ? ` (${it.sector})` : ''}: ${share(it.value / it.total)} · ${kr(it.value)}${g}`;
}
$('sunburst').addEventListener('mousemove', showTip);
// På mobil vises samme info når du trykker på en bit.
$('sunburst').addEventListener('click', showTip);
$('sunburst').addEventListener('mouseleave', () => { tip.hidden = true; });

// ---------- Tabeller ----------
function renderAccounts() {
  const accounts = state.pf.accounts.map((a) => {
    const rows = state.rows.filter((r) => r.account === a.name);
    const inv = rows.filter((r) => !r.cash);
    return { name: a.name, value: sum(rows, 'value'), day: sum(rows, 'day'), gain: sum(inv, 'gain'), cost: sum(inv, 'cost') };
  });
  const total = sum(accounts, 'value');
  $('pf-accounts').innerHTML = `<thead><tr><th>Konto</th><th>Verdi</th><th class="hide-s">Andel</th><th class="hide-xs">I dag</th><th>Gevinst</th><th class="hide-s">Gevinst %</th></tr></thead>
    <tbody>${accounts.map((a) => `<tr data-account="${esc(a.name)}" class="${a.name === state.account ? 'on' : ''}">
      <td>${esc(a.name)}</td><td>${kr(a.value)}</td><td class="hide-s">${share(total ? a.value / total : 0)}</td>
      <td class="hide-xs ${cls(a.day)}">${signed(a.day)}</td><td class="${cls(a.gain)}">${signed(a.gain)}</td><td class="hide-s ${cls(a.gain)}">${pct(a.cost > 0 ? a.gain / a.cost : null)}</td></tr>`).join('')}</tbody>`;
}
$('pf-accounts').addEventListener('click', (e) => {
  const tr = e.target.closest('tr[data-account]');
  if (tr) setAccount(tr.dataset.account === state.account ? 'alle' : tr.dataset.account);
});

const COLS = [
  ['name', 'Papir'], ['qty', 'Antall', 'hide-s'], ['last', 'Kurs', 'hide-s'], ['dayPct', 'I dag'],
  ['value', 'Verdi'], ['gain', 'Gevinst'], ['gainPct', 'Gevinst %', 'hide-s'], ['share', 'Andel', 'hide-s'],
];
function renderHoldings() {
  const rows = merged(state.rows.filter(inScope)).filter((r) => !r.cash);
  const total = sum(state.rows.filter(inScope), 'value');
  for (const r of rows) {
    r.dayPct = r.value - r.day ? r.day / (r.value - r.day) : 0;
    r.gainPct = r.cost > 0 ? r.gain / r.cost : null;
    r.share = total ? r.value / total : 0;
  }
  const { key, dir } = state.sort;
  rows.sort((a, b) => (key === 'name' ? a.name.localeCompare(b.name, 'nb') * -dir : ((a[key] ?? -Infinity) - (b[key] ?? -Infinity)) * dir));
  $('pf-hold-title').textContent = `Beholdning · ${state.account === 'alle' ? 'hele Nordnet' : state.account}`;
  const qty = (q) => q.toLocaleString('nb-NO', { maximumFractionDigits: 2 });
  $('pf-holdings').innerHTML = `<thead><tr>${COLS.map(([k, t, c]) => `<th data-sort="${k}" class="${c || ''}${k === key ? ' sorted' : ''}">${t}${k === key ? (dir < 0 ? ' ↓' : ' ↑') : ''}</th>`).join('')}</tr></thead>
    <tbody>${rows.map((r) => {
      const s = SECTOR[r.sector];
      const link = r.ticker && r.h?.type !== 'fond' ? `<a href="/#${encodeURIComponent(r.ticker)}" title="Åpne i analysen">${esc(r.name)}</a>` : esc(r.name);
      const where = state.account === 'alle' && r.accounts.length ? `<small>${esc([...new Set(r.accounts)].join(', '))}</small>` : '';
      return `<tr>
        <td><span class="sw" style="background:${s.color}" title="${s.label}"></span><span class="pf-name">${link}${r.live ? '' : ' <i class="r" title="Ingen live kurs. Bruker kursen fra Nordnet-rapporten.">R</i>'}${where}</span></td>
        <td class="hide-s">${qty(r.qty)}</td>
        <td class="hide-s">${r.last != null ? `${price(r.last)} ${r.currency}` : '–'}</td>
        <td class="${cls(r.day)}">${r.live ? pct(r.dayPct, 2) : '–'}</td>
        <td>${kr(r.value)}</td>
        <td class="${cls(r.gain)}">${signed(r.gain)}</td>
        <td class="hide-s ${cls(r.gain)}">${pct(r.gainPct)}</td>
        <td class="hide-s">${share(r.share)}</td></tr>`;
    }).join('')}</tbody>`;
}
$('pf-holdings').addEventListener('click', (e) => {
  const th = e.target.closest('th[data-sort]');
  if (!th) return;
  const k = th.dataset.sort;
  state.sort = { key: k, dir: state.sort.key === k ? -state.sort.dir : k === 'name' ? 1 : -1 };
  renderHoldings();
});

function renderAll() {
  compute();
  renderStats();
  renderChips();
  renderDist();
  renderAccounts();
  renderHoldings();
}

// ---------- Kurser ----------
async function refresh() {
  if (!state.pf) return;
  const holdings = state.pf.accounts.flatMap((a) => a.holdings);
  const fxSyms = [...new Set(holdings.map((h) => h.currency).filter((c) => c !== 'NOK'))].map((c) => `${c}NOK=X`);
  const syms = [...new Set(holdings.map((h) => h.ticker).filter(Boolean))];
  $('pf-status').textContent = 'Henter kurser …';
  try {
    const all = [...syms, ...fxSyms];
    for (let i = 0; i < all.length; i += 60) {
      Object.assign(state.quotes, await api(`/api/quotes?symbols=${all.slice(i, i + 60).map(encodeURIComponent).join(',')}`));
    }
    for (const s of fxSyms) {
      const q = state.quotes[s];
      if (q && !q.error) state.fx[s.slice(0, 3)] = { price: q.price, prev: q.prev };
    }
    state.updated = new Date();
    const live = holdings.filter((h) => liveQuote(h)).length;
    $('pf-status').innerHTML = `<span class="live-dot"></span>Oppdatert ${state.updated.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' })} · ${live} av ${holdings.length} papirer med live kurs`;
  } catch (e) {
    $('pf-status').textContent = `Fikk ikke hentet kurser: ${e.message}`;
  }
  renderAll();
}

// Fond og ETF-er uten ticker: prøv å finne dem hos Yahoo én gang.
async function resolveMissing() {
  const missing = state.pf.accounts.flatMap((a) => a.holdings).filter((h) => !h.ticker && !h.triedResolve);
  const names = [...new Map(missing.map((h) => [`${h.name}|${h.currency}`, h])).values()];
  let found = false;
  for (const h of names) {
    try {
      const r = await api(`/api/resolve?name=${encodeURIComponent(h.name)}&currency=${h.currency}&price=${h.reportPrice || ''}`);
      for (const x of missing.filter((m) => m.name === h.name && m.currency === h.currency)) {
        x.triedResolve = true;
        if (r.symbol) { x.ticker = r.symbol; x.verified = true; found = true; }
      }
    } catch {}
  }
  if (found) { await savePortfolio(); await refresh(); }
}

// ---------- Import og eksport ----------
const dialog = $('pf-dialog');
$('pf-import').addEventListener('click', () => { $('pf-error').hidden = true; dialog.showModal(); });
$('pf-file').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  if (f) $('pf-text').value = await f.text();
});
$('pf-save').addEventListener('click', async (e) => {
  e.preventDefault();
  try {
    const body = JSON.parse($('pf-text').value);
    state.pf = await api('/api/portfolio', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    dialog.close();
    show();
  } catch (err) {
    $('pf-error').textContent = `Kunne ikke lagre: ${err.message}`;
    $('pf-error').hidden = false;
  }
});
$('pf-export').addEventListener('click', () => {
  if (!state.pf) return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(state.pf, null, 1)], { type: 'application/json' }));
  a.download = `nn-portefolje-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
});
$('pf-refresh').addEventListener('click', () => refresh());

function show() {
  const has = !!state.pf?.accounts?.length;
  $('pf-empty').hidden = has;
  for (const id of ['pf-stats', 'pf-dist']) $(id).hidden = !has;
  document.querySelectorAll('.pf-card').forEach((c) => { c.hidden = !has; });
  if (!has) { $('pf-status').textContent = 'Ingen portefølje lagt inn'; return; }
  renderAll();
  refresh().then(resolveMissing);
}

// Live oppdatering hvert minutt mens siden er synlig.
setInterval(() => { if (document.visibilityState === 'visible') refresh(); }, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.updated && Date.now() - state.updated > 60000) refresh();
});

(async function init() {
  try { state.pf = await api('/api/portfolio'); } catch { state.pf = null; }
  show();
})();

