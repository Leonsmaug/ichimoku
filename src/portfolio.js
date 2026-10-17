// Nn-portefølje: beholdningen lagres bare i KV (aldri i repoet), kursene hentes live fra Yahoo.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const SYMBOL_RE = /^[A-Za-z0-9.\-^=]{1,20}$/;
const KEY = 'portfolio';
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v, max = 120) => (typeof v === 'string' ? v.slice(0, max) : null);

// Rydder og sjekker en importert portefølje, så bare kjente felt lagres.
export function cleanPortfolio(p) {
  if (!p || !Array.isArray(p.accounts)) throw new Error('Forventet et objekt med «accounts»');
  return {
    version: 1,
    asOf: str(p.asOf, 10),
    source: str(p.source),
    accounts: p.accounts.slice(0, 30).map((a) => ({
      name: str(a.name, 60) || 'Konto',
      cash: num(a.cash) ?? 0,
      holdings: (Array.isArray(a.holdings) ? a.holdings : []).slice(0, 200).map((h) => ({
        name: str(h.name) || '?',
        ticker: typeof h.ticker === 'string' && SYMBOL_RE.test(h.ticker) ? h.ticker : null,
        verified: h.verified === true,
        type: ['aksje', 'etf', 'fond'].includes(h.type) ? h.type : 'aksje',
        sector: str(h.sector, 20),
        qty: num(h.qty) ?? 0,
        currency: str(h.currency, 3) || 'NOK',
        reportPrice: num(h.reportPrice),
        costPrice: num(h.costPrice),
        valueNok: num(h.valueNok) ?? 0,
        resultNok: num(h.resultNok) ?? 0,
      })),
    })),
  };
}

export async function getPortfolio(env) {
  return (env.STATE && (await env.STATE.get(KEY, 'json'))) || null;
}

export async function putPortfolio(env, body) {
  const clean = cleanPortfolio(body);
  await env.STATE.put(KEY, JSON.stringify(clean));
  return clean;
}

// Siste kurs og forrige sluttkurs for én ticker.
export async function quote(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=1d&interval=1d`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, cf: { cacheTtl: 60, cacheEverything: true } });
  if (!res.ok) throw new Error(`Yahoo svarte ${res.status}`);
  const m = (await res.json())?.chart?.result?.[0]?.meta;
  if (!m || m.regularMarketPrice == null) throw new Error('Ingen kurs');
  return {
    price: m.regularMarketPrice,
    prev: m.chartPreviousClose ?? m.previousClose ?? null,
    currency: m.currency,
    name: m.longName || m.shortName || symbol,
    time: m.regularMarketTime ? new Date(m.regularMarketTime * 1000).toISOString() : null,
  };
}

export async function quotes(symbols) {
  const out = {};
  for (let i = 0; i < symbols.length; i += 8) {
    await Promise.all(symbols.slice(i, i + 8).map(async (s) => {
      try { out[s] = await quote(s); } catch (e) { out[s] = { error: String(e.message || e) }; }
    }));
  }
  return out;
}

// Finner Yahoo-tickeren til fond og ETF-er ut fra navnet. Godtar bare treff med samme
// valuta og en kurs som ligger nær kursen i Nordnet-rapporten, så vi ikke viser feil papir.
export async function resolve(name, currency, price, env) {
  const key = `resolve:${currency}:${name}`.slice(0, 480);
  const cached = env?.STATE && (await env.STATE.get(key, 'json'));
  if (cached) return cached;
  const url = `https://query2.finance.yahoo.com/v1/finance/search?q=${encodeURIComponent(name)}&quotesCount=10&newsCount=0&listsCount=0`;
  const res = await fetch(url, { headers: { 'user-agent': UA }, cf: { cacheTtl: 86400, cacheEverything: true } });
  const list = res.ok ? ((await res.json()).quotes || []) : [];
  const candidates = list.filter((x) => x.symbol && ['EQUITY', 'ETF', 'MUTUALFUND'].includes(x.quoteType)).slice(0, 6);
  let out = { symbol: null };
  for (const c of candidates) {
    try {
      const q = await quote(c.symbol);
      if (q.currency !== currency) continue;
      if (price && Math.abs(q.price / price - 1) > 0.25) continue;
      out = { symbol: c.symbol, price: q.price, name: q.name };
      break;
    } catch {}
  }
  // Treff huskes i 30 dager, bom i ett døgn.
  if (env?.STATE) await env.STATE.put(key, JSON.stringify(out), { expirationTtl: out.symbol ? 30 * 86400 : 86400 });
  return out;
}
