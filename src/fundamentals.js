// Nøkkeltall for fundamental analyse fra Yahoo Finance (quoteSummary).
// Yahoo krever en cookie og en «crumb» for dette endepunktet; begge caches i KV.

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MODULES = 'price,summaryDetail,defaultKeyStatistics,financialData,assetProfile,recommendationTrend';

async function newSession() {
  const r = await fetch('https://fc.yahoo.com/', { headers: { 'user-agent': UA }, redirect: 'manual' });
  const raw = r.headers.getSetCookie?.() || [r.headers.get('set-cookie')].filter(Boolean);
  const cookie = raw.map((c) => c.split(';')[0]).filter((c) => /^A[13S]?=/.test(c)).join('; ');
  if (!cookie) throw new Error('Fikk ingen cookie fra Yahoo');
  const c = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'user-agent': UA, cookie } });
  const crumb = (await c.text()).trim();
  if (!c.ok || !crumb || crumb.includes('<') || crumb.length > 40) throw new Error('Fikk ingen crumb fra Yahoo');
  return { cookie, crumb };
}

async function session(env, refresh = false) {
  if (!refresh && env?.STATE) {
    const s = await env.STATE.get('yahoo:session', 'json');
    if (s) return s;
  }
  const s = await newSession();
  if (env?.STATE) await env.STATE.put('yahoo:session', JSON.stringify(s), { expirationTtl: 6 * 3600 });
  return s;
}

const raw = (o) => (o && typeof o === 'object' ? (o.raw ?? null) : (typeof o === 'number' ? o : null));

export function normalize(r) {
  const p = r.price || {}, sd = r.summaryDetail || {}, ks = r.defaultKeyStatistics || {}, fd = r.financialData || {}, ap = r.assetProfile || {};
  const trend = r.recommendationTrend?.trend?.find((t) => t.period === '0m');
  return {
    available: true,
    currency: p.currency || sd.currency || null,
    financialCurrency: fd.financialCurrency || null,
    price: raw(p.regularMarketPrice) ?? raw(fd.currentPrice),
    marketCap: raw(p.marketCap) ?? raw(sd.marketCap),
    pe: raw(sd.trailingPE),
    forwardPe: raw(sd.forwardPE) ?? raw(ks.forwardPE),
    pb: raw(ks.priceToBook),
    ps: raw(sd.priceToSalesTrailing12Months),
    evEbitda: raw(ks.enterpriseToEbitda),
    peg: raw(ks.pegRatio),
    eps: raw(ks.trailingEps),
    dividendYield: raw(sd.dividendYield) ?? raw(sd.trailingAnnualDividendYield),
    payoutRatio: raw(sd.payoutRatio),
    roe: raw(fd.returnOnEquity),
    roa: raw(fd.returnOnAssets),
    profitMargin: raw(fd.profitMargins) ?? raw(ks.profitMargins),
    operatingMargin: raw(fd.operatingMargins),
    debtToEquity: raw(fd.debtToEquity),
    currentRatio: raw(fd.currentRatio),
    revenueGrowth: raw(fd.revenueGrowth),
    earningsGrowth: raw(fd.earningsGrowth),
    beta: raw(sd.beta) ?? raw(ks.beta),
    high52: raw(sd.fiftyTwoWeekHigh),
    low52: raw(sd.fiftyTwoWeekLow),
    targetMean: raw(fd.targetMeanPrice),
    analysts: raw(fd.numberOfAnalystOpinions),
    recommendation: fd.recommendationKey && fd.recommendationKey !== 'none' ? fd.recommendationKey : null,
    recommendationCounts: trend ? { kjop: (trend.strongBuy || 0) + (trend.buy || 0), hold: trend.hold || 0, selg: (trend.sell || 0) + (trend.strongSell || 0) } : null,
    sector: ap.sector || null,
    industry: ap.industry || null,
    employees: ap.fullTimeEmployees || null,
    website: ap.website || null,
  };
}

async function quoteSummary(symbol, env, retry = true) {
  const s = await session(env, !retry);
  const url = `https://query2.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=${MODULES}&crumb=${encodeURIComponent(s.crumb)}`;
  const res = await fetch(url, { headers: { 'user-agent': UA, cookie: s.cookie } });
  if ((res.status === 401 || res.status === 403) && retry) return quoteSummary(symbol, env, false);
  if (!res.ok) throw new Error(`Yahoo svarte ${res.status}`);
  const body = await res.json();
  const r = body?.quoteSummary?.result?.[0];
  if (!r) throw new Error(body?.quoteSummary?.error?.description || 'Fant ingen nøkkeltall');
  return r;
}

export async function fundamentals(symbol, env) {
  const key = `fund:${symbol}`;
  const cached = env?.STATE && (await env.STATE.get(key, 'json'));
  if (cached) return cached;
  try {
    const out = normalize(await quoteSummary(symbol, env));
    if (env?.STATE) await env.STATE.put(key, JSON.stringify(out), { expirationTtl: 12 * 3600 });
    return out;
  } catch (e) {
    return { available: false, reason: String(e.message || e) };
  }
}
