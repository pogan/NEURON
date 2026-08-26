# NEURON

A self-hosted web application for searching and monitoring the **EUIPO** (EU Intellectual
Property Office) trademark and design registries, plus the Polish Patent Office's
(**UPRP**) e-Wyszukiwarka register. It was built as a practical business tool — trademark
attorneys and rights holders need to know the moment someone files a mark or design that
collides with theirs, and the official EUIPO/UPRP portals don't offer that kind of
continuous, automated watch. NEURON does three things: it gives a fast, form-driven UI
over the raw search APIs, it caches and logs every query locally, and it runs a background
scheduler that polls saved search patterns and flags newly appeared registrations.

No build step, no framework lock-in: server-rendered Express + EJS, vanilla ES modules on
the front end, SQLite on disk. It's a deliberately small, single-process app that a solo
operator can run on one VPS behind nginx.

## What it solves

EUIPO exposes public REST APIs for trademark and design search
(`trademark-search`/`design-search`, OpenAPI specs vendored under `docs/euipo/`) and UPRP
exposes an XML-based search service (`e-Wyszukiwarka`, doc under `docs/`). Both require
OAuth2/API-key credentials that must never reach a browser, both have real rate limits,
and both return dense, multi-language, multi-field records that are painful to read
without a purpose-built UI. NEURON wraps both behind one interface so a search across
either registry — and continuous monitoring of either — is a few clicks away, with
credentials that stay server-side.

## Architecture and key decisions

**Proxy pattern, not a passthrough API.** The browser never talks to EUIPO/UPRP directly
and never sees an API key. `src/routes/api.js` is a thin local proxy — it forwards search
parameters, streams binary assets (images, thumbnails, video, 3D models), and adds
server-side concerns (request logging, error normalization) the raw APIs don't provide.
This also means CORS and API-side rate limiting are the server's problem, not the
browser's.

**OAuth2 client-credentials with in-process token caching.** `src/euipo.js` and
`src/uprp.js` each fetch a token once, cache it in memory with its expiry, and transparently
refresh on a `401` (one retry, to survive clock skew or early revocation) rather than
re-authenticating on every request. UPRP doesn't return a token TTL in its response, so the
client decodes the JWT payload itself to recover `exp`.

**Sandbox/production switching via one env var.** `ENV=sandbox` vs `ENV=production` in
`.env` swaps the OAuth token endpoint, the API host, and the credential pair used — see the
table in `src/config.js`. The UI shows a **SANDBOX** badge and every logged request/alert is
tagged with the environment it ran in, so test and production activity never mix in the
history or in monitoring data. This was a real constraint during development: production
API access is subscription-gated and approved manually by EUIPO, so most work happened
against sandbox with a one-line cutover ready for when production access activates.

**Incremental detail loading to respect API rate limits.** Search results list only summary
fields. Expanding a row triggers a `GET /{id}` for the full record, and only one row's
media (images/thumbnails/sound/video/3D model) is fetched at a time — each asset request
only fires if the record actually declares that asset exists, avoiding needless 404s. This
keeps request volume proportional to what a user actually inspects, not to page size.

**RSQL query builder.** Both EUIPO APIs use RSQL for filtering. `src/metadata.js` derives
the available fields, operators, and enums directly from the vendored OpenAPI specs, and
the search UI builds valid RSQL from a field/operator/value picker instead of asking users
to hand-write query syntax.

**Alert scheduler as a first-class feature, not a cron job bolted on.** `src/monitor.js`
implements watch-list monitoring: an alert is a wildcard pattern against a record's word
element (e.g. `*brand*`), translated into an RSQL filter. Creating an alert seeds it with
every currently-matching record (paginated, capped, sorted newest-first so truncation never
hides new entries) so nothing already on file gets flagged as "new." An in-process
`setInterval` scheduler (started with the server, kept alive by PM2) re-checks each active
alert on its own interval, diffs against previously seen record IDs, and flags genuinely new
matches — with catch-up on restart so a missed interval isn't silently lost. Alerts are
scoped per environment so a sandbox test alert can't pollute production monitoring.

**Static asset cache-busting without a build pipeline.** `public/` is served with
`Cache-Control: no-cache` plus a `?v=` query param computed once at startup from each
file's mtime (`assetVersion()` in `src/config.js`). Browsers revalidate (cheap `304`s) but
never serve a stale CSS/JS file after a deploy — no bundler, no manifest, just a restart.

**Password gate, not a full auth system.** `src/auth.js` is a single shared-password gate
(`WEBSITE_PASS`) issuing an HMAC-signed, timing-safe-compared session cookie. Deliberately
minimal: this is a single-operator tool, not a multi-user product, so a full user/roles
system would have been overengineering. `/healthz` stays outside the gate for uptime
monitoring.

**Small correctness fixes that mattered in practice** — worth flagging because they're the
kind of thing that only surfaces under real API traffic: Node's `fetch` sends
`Accept-Language: *` by default, which EUIPO's design API rejects with a 400; the client
sets the header explicitly on every request instead. UPRP's error responses come back with
an empty body on a plain "not found," so the client falls back to a readable message instead
of surfacing a bare status code.

## Stack

- Node.js ≥ 20, Express 4, EJS (no build step)
- Bootstrap 5.3 + Bootstrap Icons + Google Fonts, loaded from CDN
- Hand-written CSS (`public/css/style.css`) — no SCSS/Tailwind needed at this scale
- SQLite via `better-sqlite3` — request log, saved searches, alert state
- `fast-xml-parser` for UPRP's XML responses
- OAuth2 client-credentials auth with in-memory token caching (EUIPO + UPRP, separate clients)

## Project layout

```
src/
  server.js        Express app, page routing, error handling
  config.js        .env-driven config, environment switching, asset versioning
  euipo.js         EUIPO client: OAuth2 token cache, request/retry, rate-limit headers
  uprp.js          UPRP client: JWT token cache, XML/JSON response handling
  auth.js          Shared-password session gate (HMAC-signed cookie)
  metadata.js      RSQL fields/operators/enums derived from the EUIPO OpenAPI specs
  uprp-meta.js     Field metadata for the UPRP search UI
  db.js            SQLite schema + queries: request_log, saved_query, alerts
  monitor.js       Alert scheduler: seeding, diffing, periodic checks
  routes/api.js    Local JSON proxy + media streaming for EUIPO
  routes/uprp.js   Local proxy for UPRP
views/             EJS templates
public/            Front-end CSS + vanilla ES module JS (no bundler)
docs/euipo/        Vendored EUIPO OpenAPI specs (trademark-search, design-search)
docs/              UPRP e-Wyszukiwarka API documentation (PDF)
```

## Environments

`ENV` in `.env` switches the whole app between EUIPO's sandbox and production systems —
different auth server, different API host, different credential pair:

| `ENV`        | Token endpoint                                                | API host                              | Credentials |
|--------------|-----------------------------------------------------------------|----------------------------------------|-------------|
| `sandbox`    | `https://auth-sandbox.euipo.europa.eu/oidc/accessToken`         | `https://api-sandbox.euipo.europa.eu`  | `EUIPO_SANDBOX_API_KEY` / `..._SECRET` |
| `production` | `https://euipo.europa.eu/cas-server-webapp/oidc/accessToken`    | `https://api.euipo.europa.eu`          | `EUIPO_API_KEY` / `EUIPO_API_SECRET` |

The active environment is visible in the UI (SANDBOX badge), in the startup log, and via
`/healthz` and `/api/token`.

## Pages

| Route         | Purpose |
|---------------|---------|
| `/`           | Landing page, OAuth2 token status |
| `/trademarks` | EUIPO trademark search, record detail, media |
| `/designs`    | EUIPO design search, record detail, views |
| `/uprp`       | UPRP e-Wyszukiwarka search and record detail |
| `/alerts`     | Create/manage watch-list alerts, review new matches |
| `/history`    | Request log and usage stats from SQLite |
| `/healthz`    | Health check for process monitoring (outside the auth gate) |

Each search page covers the full lifecycle of a query: an RSQL query builder (field /
operator / value / and-or), full support for `query`, `fields`, `page`, `size`, `sort`,
and `Accept-Language`; results as a card table or raw highlighted JSON; saved searches. Row
expansion loads the full record plus every media asset it declares, with values translated
to readable labels and dates normalized — without triggering requests for assets the record
doesn't have.

## Local API (proxy)

The front end talks only to this local surface — EUIPO/UPRP credentials never leave the
server:

```
GET /api/meta
GET /api/token
GET /api/trademarks?query&fields&page&size&sort&lang
GET /api/trademarks/:applicationNumber?fields&lang
GET /api/trademarks/:applicationNumber/{image|image/thumbnail|sound|video|model}
GET /api/designs?query&fields&page&size&sort&lang
GET /api/designs/:designNumber?fields&lang
GET /api/designs/:designNumber/views/:order[/thumbnail]
GET /api/designs/:designNumber/{model|video}
GET /api/uprp/...                     UPRP search/detail (see routes/uprp.js)

GET    /api/alerts                    list alerts + new-match counts
GET    /api/alerts/summary            total new matches (nav badge)
GET    /api/alerts/preview?api&pattern  preview the RSQL generated from a pattern
POST   /api/alerts                    { api, name, pattern } — create alert + seed
GET    /api/alerts/:id                alert + records + check history
POST   /api/alerts/:id/check          manual check
POST   /api/alerts/:id/ack            mark new matches as read
POST   /api/alerts/:id/toggle         pause / resume
DELETE /api/alerts/:id                delete alert and its history

GET /api/history?limit
GET /api/stats
GET|POST|DELETE /api/saved/:api[/:id]
```

## Alerts (monitoring)

An alert watches a registry for a wildcard pattern against a record's word element (e.g.
`*brand*`):

1. **Seed** — on creation, the alert fetches every currently-matching record (paginated
   100/page, sorted newest-first, capped at 1,000) and stores it as the known baseline.
2. **Schedule** — an in-process scheduler (starts with the server, kept running by PM2)
   ticks every 15 minutes and re-checks any alert past its `interval_hours` (24h default);
   a missed check after a restart is caught up on the first tick (~60s after boot).
3. **Detection** — any record not already in the stored baseline is flagged **NEW**: a
   badge on the alert, a counter in the nav, an entry in the check history. "Mark as read"
   clears the flags.

Alert detail is an accordion of matched records (thumbnail, status, filing date); expanding
one shows the full record from its stored snapshot. Alerts are scoped per environment, so a
sandbox alert is never checked once the app is switched to production. Data lives in three
tables — `alert`, `alert_record`, `alert_check` — with cascading delete.

## Running it

```bash
npm install
cp .env.example .env      # set ENV and the credential pair for that environment
npm start                 # production
npm run dev                # auto-restart on file change
```

### PM2

```bash
pm2 start ecosystem.config.cjs
pm2 save
```

### nginx (reverse proxy)

```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_http_version 1.1;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

To run under a subpath (e.g. `/neuron`), set `BASE_PATH=/neuron` in `.env` — all routes
(`/static`, `/api`, pages) shift under that prefix automatically.

## API access status

**Sandbox — working.** Both EUIPO APIs return test data: search, record detail, trademark
images, design views, and multimedia video all function.

**Production — pending subscription.** Production credentials correctly obtain an OAuth2
token, but the API responds `403 Unauthorized request`: the application registered on
[developer.euipo.europa.eu](https://developer.euipo.europa.eu) doesn't yet have an active
subscription to the *Trademark search* and *Design search* products, which EUIPO approves
manually. Once approved, switching is just `ENV=production` and a restart — no code changes
required.
