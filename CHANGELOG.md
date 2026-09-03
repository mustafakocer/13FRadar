# Changelog

All notable changes to 13F Radar. Dates are UTC.

## [Unreleased]

### Step 0 — 2026-09-03
- Added `FEATURE_AUDIT.md` (codebase map, assumptions, before/after feature matrix).
- Added engineering scaffolding: `node:test` suites (`npm test`), ESLint 9 flat config (`npm run lint`), `tsc --checkJs` on `// @ts-check` modules (`npm run typecheck`).
- Added feature flags (`FEATURE_FLAGS` server / `VITE_FEATURE_FLAGS` client, default all on).
- Added plan helpers (`api/_lib/plan.js`): free = current + previous quarter, 5 watchlist items; pro = unlimited.
- Added request validators (`api/_lib/validate.js`).
- Added SPK notice component rendered on every page including print.
- Ported existing ad-hoc checks into tests: 13F amendment merging, share-based trade stats, estimated average buy price, cash-like detection.
