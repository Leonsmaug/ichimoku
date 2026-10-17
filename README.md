# Skyvakt

Personlig nettside for teknisk analyse med Ichimoku-sky og kjøpssignaler. Lys og mørk modus, lesning i klartekst, historikk for signalene og kakediagram over watchlisten.
Kjører gratis på Cloudflare Workers.

*Teknisk analyse, ikke personlig investeringsrådgivning.*

## Innhold

- `public/` – nettsiden (statiske filer). Grafen er TradingView Lightweight Charts v5.2.1, lagt inn i `public/vendor/`.
- `public/ichimoku.js` – Ichimoku-beregning og signaler. Brukes av både nettsiden og workeren.
- `src/worker.js` – API (`/api/chart`, `/api/search`, `/api/scan`, `/api/watchlist`) som henter kurser fra Yahoo Finance, og den daglige varslingsjobben.
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
3. Bare for deg: Settings → Domains & Routes → workers.dev → slå på Cloudflare Access, og tillat bare din e-post.

## Lokalt

```
npm install
npm test
npx wrangler dev
```
