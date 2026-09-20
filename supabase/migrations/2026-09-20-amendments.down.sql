-- Reverts 2026-09-20-amendments.up.sql. No data is lost that the up
-- migration did not add: the two columns and the view go, report_date and
-- every holdings row stay exactly as the backfill wrote them.
drop view if exists public.effective_filings;
drop index if exists public.filings_cik_period;
alter table public.filings
  drop column if exists amendment_type,
  drop column if exists period_of_report;
