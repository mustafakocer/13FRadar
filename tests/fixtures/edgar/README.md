# Real 13F filings (EDGAR)

Information tables and cover pages exactly as filed, fetched 2026-11-20 from `https://www.sec.gov/Archives/edgar/data/<cik>/<accession>/` by `tests/fixtures/make-edgar-fixtures.mjs`. Used by `tests/edgar-reconcile.test.mjs`; the fund list and the reason each is here are in `config/reconcile-funds.json`.

`closes.json` next to each table holds the period-end closes of its priced rows (from the price archive on the fetch date), so the unit check the pipeline runs is deterministic. `manifest.json` records, per fund, the filing, its amendments and what the site stored for it that day (`api/_data/latest-holdings.json`).

Do not edit these files by hand: re-run the script to refresh them to each fund's latest filing.

| Fund | CIK | Period | Accession | Amendments |
|---|---|---|---|---|
| Berkshire Hathaway (Warren Buffett) | 0001067983 | 2026-09-30 | 0001193125-26-463399 (filed 2026-11-16) | — |
| Baupost Group (Seth Klarman) | 0001061768 | 2026-09-30 | 0001061768-26-000015 (filed 2026-11-13) | — |
| Duquesne Family Office (Druckenmiller) | 0001536411 | 2026-09-30 | 0001536411-26-000011 (filed 2026-11-16) | — |
| Himalaya Capital (Li Lu) | 0001709323 | 2026-09-30 | 0002043585-26-000030 (filed 2026-11-16) | — |
| Akre Capital Management | 0001112520 | 2026-09-30 | 0001112520-26-000022 (filed 2026-11-13) | — |
| Appaloosa (David Tepper) | 0001656456 | 2026-09-30 | 0001656456-26-000004 (filed 2026-11-16) | — |
| Third Point (Dan Loeb) | 0001040273 | 2026-09-30 | 0001040273-26-000004 (filed 2026-11-16) | — |
| Tiger Global Management | 0001167483 | 2026-09-30 | 0000919574-26-008062 (filed 2026-11-16) | — |
| Soros Fund Management | 0001029160 | 2026-09-30 | 0000902664-26-004530 (filed 2026-11-13) | — |
| Vision Capital Corp | 0001764403 | 2026-09-30 | 0001764403-26-000005 (filed 2026-11-13) | 0001764403-26-000006 (RESTATEMENT, 2026-11-13) |
| CISCO SYSTEMS, INC. | 0000858877 | 2026-09-30 | 0001193125-26-422871 (filed 2026-10-15) | 0001193125-26-463822 (NEW HOLDINGS, 2026-11-16) |
| Luxor Capital Group, LP | 0001316580 | 2026-09-30 | 0001316580-26-000005 (filed 2026-11-16) | — |
| TIMUCUAN ASSET MANAGEMENT INC/FL | 0001034541 | 2026-09-30 | 0001034541-26-000008 (filed 2026-11-13) | — |
