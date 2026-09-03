# Changelog

All notable changes to 13F Radar. Dates are UTC.

## [Unreleased]

### P1-5 Form 4 insider transactions — 2026-09-03
- New daily ingest of every Form 4 / 4-A from EDGAR's daily form index into `client/public/insiders.json` (open-market purchases and sales, equity only, last 30 days, ≥ $10k, deduplicated). Roles are classified from the filing (CEO, CFO, COO, President, Officer, Director, 10% owner).
- New `/insiders` page: largest buys, largest sells, full list by date; filters by role, amount band and text (Pro); free plan sees 20 rows per list.
- Stock page insider table now shows the role and links to the feed. Feature flag `insiders`.

### P0-4 Watchlists & fund groups — 2026-09-03
- Stock watchlist (per user, Supabase) with aggregate institutional ownership: number of 13F filers holding the stock, total value, and quarter-over-quarter change. The universe build now writes `stocks.json` with 2,000 rows + reporting period and rotates the previous period into `stocks-prev.json` when the period advances.
- Fund groups: create groups, add up to 5 (free) / 20 (Pro) funds, view the combined "super fund" portfolio AUM-weighted or equal-weighted (treemap + table + holder counts) and the group's NEW / ADD / REDUCE / EXIT moves this quarter.
- Watchlist page now has Fonlar / Hisseler / Fon Grupları tabs; fund favourites capped at 5 on the free plan; ☆ watch button on stock pages. Feature flag `watchlists`.

### P0-3 Alerts — 2026-09-03
- Users can follow funds (CIK) and stocks (CUSIP) for email alerts: `🔔` on fund/stock pages, management on the account page. Free plan: 5 subscriptions; Pro unlimited. Feature flag `alerts`.
- New Supabase tables `alert_subscriptions` and `alert_deliveries` (RLS; deliveries unique per user/kind/key/filing event so nothing is sent twice; amendments create a new event id).
- `scripts/send-alerts.mjs` (GitHub Action every 2 hours) reads the latest 13F of every followed fund, diffs it against the prior filing (NEW / ADD / REDUCE / EXIT, split-aware) and sends a Turkish summary email through Resend (`RESEND_API_KEY`, `ALERTS_FROM`, `SITE_URL`). Claim-then-send with up to 3 retries; filings older than 30 days are recorded as skipped instead of emailed.
- Stock alerts are evaluated against the filings of all followed funds plus the curated superinvestor list.
- Web push not implemented (no PWA manifest in the app).

### P0-2 Fund overlap comparison — 2026-09-03
- New `/api/overlap?ciks=a,b[,c,d,e]`: shared positions with each fund's weight, unique-to-each lists, pairwise Jaccard and weighted overlap (Σ min weight), overall Jaccard, and shared buys / sells in the latest quarter (NEW/ADD vs REDUCE/EXIT via the position diff engine). Options excluded. Free plan compares 2 funds, Pro up to 5. Feature flag `overlap`.
- Compare page (managers mode) now supports up to 5 pickers with a Turkish methodology note; the stocks mode stays Pro.

### P0-1 Position history timeline — 2026-09-03
- `/api/position-history/:cik/:cusip` now returns a complete quarter grid with `filed`/`held` flags and per-quarter actions (NEW / ADD / REDUCE / EXIT / HOLD / START). Quarters without a filing are never counted as EXIT; splits are neutralised; zero share counts fall back to value deltas.
- Plan gating: free plan gets the newest 2 filed quarters, Pro up to 40 (`limit` query, default 16). Feature flag `positionTimeline`.
- New `PositionTimeline` component (weight % / market value / share count toggle, colour-coded bars, badge strip that scrolls on mobile) replaces the old weight-only panel in the holdings table and is available per holder on stock pages.
- `t()` now supports `{var}` interpolation.

### Step 0 — 2026-09-03
- Added `FEATURE_AUDIT.md` (codebase map, assumptions, before/after feature matrix).
- Added engineering scaffolding: `node:test` suites (`npm test`), ESLint 9 flat config (`npm run lint`), `tsc --checkJs` on `// @ts-check` modules (`npm run typecheck`).
- Added feature flags (`FEATURE_FLAGS` server / `VITE_FEATURE_FLAGS` client, default all on).
- Added plan helpers (`api/_lib/plan.js`): free = current + previous quarter, 5 watchlist items; pro = unlimited.
- Added request validators (`api/_lib/validate.js`).
- Added SPK notice component rendered on every page including print.
- Ported existing ad-hoc checks into tests: 13F amendment merging, share-based trade stats, estimated average buy price, cash-like detection.
