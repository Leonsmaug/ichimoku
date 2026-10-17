# Skyvakt

Personlig nettside for teknisk analyse med Ichimoku-sky og kjøpssignaler. Lys og mørk modus, lesning i klartekst, historikk for signalene og kakediagram over watchlisten.
Kjører gratis på Cloudflare Workers.

*Teknisk analyse, ikke personlig investeringsrådgivning.*

## Innhold

- `public/` – nettsiden (statiske filer). Grafen er TradingView Lightweight Charts v5.2.1, lagt inn i `public/vendor/`.
- `public/ichimoku.js` – Ichimoku-beregning og signaler. Brukes av både nettsiden og workeren.
- Kart over hovedkontoret for norske selskaper: adresse fra Brønnøysundregistrene, koordinater fra Kartverkets adresse-API, vist med MapLibre GL JS 5.24.0 (lagt inn i `public/vendor/maplibre/`) og OpenFreeMap-stilen liberty.
- `src/worker.js` – API (`/api/chart`, `/api/search`, `/api/scan`, `/api/watchlist`, `/api/weights`, `/api/company`) som henter kurser fra Yahoo Finance, og den daglige varslingsjobben.
- `wrangler.jsonc` – Cloudflare-oppsett: KV-lagring for watchlist og cron hverdager 15:30 og 21:30 UTC.

## Signaler

Sterkt kjøpssignal når alle fire er sanne på siste candle:

1. Kurs lukker over skyen.
2. Tenkan har krysset over Kijun de siste 5 periodene.
3. Chikou (dagens kurs) er over kursen for 26 perioder siden.
4. Skyen 26 perioder frem er grønn (Senkou A > Senkou B).

Svakt kjøpssignal: kursbrudd opp gjennom skyen, eller TK-kryss som ikke er under skyen.

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
