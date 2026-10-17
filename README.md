# Skyvakt

Personlig nettside for teknisk og fundamental analyse. Kjøpssignaler fra enten Ichimoku-skyen eller CCI, Bollinger Bands og MACD sammen, og en egen fane med nøkkeltall som P/E. Lys og mørk modus, lesning i klartekst, historikk for signalene og kakediagram over watchlisten.
Kjører gratis på Cloudflare Workers.

*Analyse, ikke personlig investeringsrådgivning.*

Versjon 1 (bare Ichimoku) ligger på grenen `v1`.

## Innhold

- `public/` – nettsiden (statiske filer). Grafen er TradingView Lightweight Charts v5.2.1, lagt inn i `public/vendor/`.
- `public/ichimoku.js` – Ichimoku-beregning og signaler. Brukes av både nettsiden og workeren.
- `public/indicators.js` – CCI, Bollinger Bands, MACD og det samlede signalet fra dem.
- `public/strategies.js` – de to signalstrategiene, felles for nettside og worker.
- `src/fundamentals.js` – nøkkeltall fra Yahoo Finance (quoteSummary med cookie og crumb), mellomlagret i KV i 12 timer.
- Kart over hovedkontoret for norske selskaper: adresse fra Brønnøysundregistrene, koordinater fra Kartverkets adresse-API, vist med MapLibre GL JS 5.24.0 (lagt inn i `public/vendor/maplibre/`) og OpenFreeMap-stilen liberty.
- `src/worker.js` – API (`/api/chart`, `/api/search`, `/api/scan`, `/api/watchlist`, `/api/weights`, `/api/company`, `/api/settings`, `/api/fundamentals`, `/api/portfolio`, `/api/quotes`, `/api/resolve`) som henter kurser fra Yahoo Finance, og den daglige varslingsjobben.
- `wrangler.jsonc` – Cloudflare-oppsett: KV-lagring for watchlist og cron hverdager 15:30 og 21:30 UTC.

## Signaler

Sterkt kjøpssignal når alle fire er sanne på siste candle:

1. Kurs lukker over skyen.
2. Tenkan har krysset over Kijun de siste 5 periodene.
3. Chikou (dagens kurs) er over kursen for 26 perioder siden.
4. Skyen 26 perioder frem er grønn (Senkou A > Senkou B).

Svakt kjøpssignal: kursbrudd opp gjennom skyen, eller TK-kryss som ikke er under skyen.

### CCI + Bollinger Bands + MACD

Velges med knappen «Kjøpssignal» øverst. Valget lagres på serveren, så varslene følger det samme. Sterkt kjøpssignal når alle tre har skjedd de siste 8 periodene:

1. CCI (20) har krysset opp gjennom −100.
2. Kursen har vært nede ved nedre Bollinger-bånd (20, 2) og lukker nå over det.
3. MACD (12, 26) har krysset over signallinjen (9) og ligger fortsatt over.

To av tre gir svakt kjøpssignal. Ellers vises positiv trend (over midtlinjen og MACD over signallinjen), negativ trend (begge under) eller nøytral.

## Fundamental

Fanen «Fundamental» viser verdsettelse (P/E, forward P/E, P/B, EV/EBITDA, P/S, PEG), lønnsomhet, vekst, utbytte, gjeld og risiko, 52-ukers spenn og analytikernes kursmål. Fargene er grove tommelfingerregler og varierer mye mellom bransjer.

## Nn-portefølje

Egen side på `/portefolje` (lenken «Nn-portefølje» under logoen) med beholdningen fra Nordnet, live kurser fra Yahoo, gevinst mot anskaffelsesverdi (inkludert valuta), dagens endring og et sektordiagram per konto og samlet (GICS-sektorer). Beholdningen importeres som JSON på siden og lagres bare i KV bak innloggingen, aldri i dette repoet. Fond og ETF-er uten ticker slås opp hos Yahoo på navn og godtas bare når valuta og kurs stemmer med rapporten.

## Oppsett på Cloudflare (én gang)

1. Workers & Pages → Create → Import a repository → velg dette repoet. Build command: tom. Deploy command: `npx wrangler deploy`.
2. Varsler: installer ntfy-appen på mobilen og abonner på et hemmelig emnenavn. Legg samme navn inn som hemmelighet `NTFY_TOPIC` under workerens Settings → Variables and Secrets. Sett gjerne `APP_URL` til adressen til siden, så åpner varselet riktig aksje.
3. Innlogging: legg inn `APP_USER` (brukernavn) og `APP_PASSWORD` (passord) som secrets under Settings → Variables and Secrets. Uten dem er siden stengt. Innloggingen varer i 30 dager per nettleser, og bytter du passord blir alle logget ut. Etter 8 feil forsøk fra samme IP stenges innlogging i et kvarter.

## Lokalt

```
npm install
npm test
npx wrangler dev
```
