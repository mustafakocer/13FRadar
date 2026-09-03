# Changelog

All notable changes to 13F Radar. Dates are UTC.

## [Unreleased]

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
