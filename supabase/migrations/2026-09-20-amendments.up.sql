-- 13F-HR/A support in the historical store.
--
-- Raw filings stay one row per accession (the audit trail). Two columns
-- carry what the cover page says — the period the document itself reports,
-- and for an amendment whether it restates the table or adds to it — and a
-- view answers the question every derived computation asks: for a filer and
-- a period, which document is the base and which amendments apply to it,
-- in filing order.
--
-- Apply:  psql "$DATABASE_URL" -f supabase/migrations/2026-09-20-amendments.up.sql
-- Revert: psql "$DATABASE_URL" -f supabase/migrations/2026-09-20-amendments.down.sql

alter table public.filings
  add column if not exists period_of_report date,
  add column if not exists amendment_type text
    check (amendment_type is null or amendment_type in ('RESTATEMENT', 'NEW HOLDINGS'));

comment on column public.filings.period_of_report is
  'periodOfReport from the filing''s own cover page; report_date is the index-derived value';
comment on column public.filings.amendment_type is
  '13F-HR/A only: RESTATEMENT replaces the original table, NEW HOLDINGS is added to it';

create index if not exists filings_cik_period on public.filings (cik, coalesce(period_of_report, report_date) desc, filed);

-- One row per (cik, period): the base document (latest-filed 13F-HR, or the
-- earliest amendment when no original is stored) and the amendments to apply
-- to it, oldest first. Consumers read holdings for base_acc and each of
-- amendment_accs and fold them exactly as api/_lib/amendments.js does.
create or replace view public.effective_filings as
with periods as (
  select
    acc, cik, form, amended, filed, amendment_type,
    coalesce(period_of_report, report_date) as period
  from public.filings
  where coalesce(period_of_report, report_date) is not null
),
base as (
  select distinct on (cik, period)
    cik, period, acc as base_acc, filed as base_filed, amended as base_is_amendment
  from periods
  order by cik, period, (case when amended then 1 else 0 end), filed desc, acc desc
)
select
  b.cik,
  b.period,
  b.base_acc,
  b.base_filed,
  b.base_is_amendment,
  coalesce(
    array_agg(p.acc order by p.filed, p.acc) filter (where p.acc is not null),
    '{}'::text[]
  ) as amendment_accs,
  coalesce(
    array_agg(p.amendment_type order by p.filed, p.acc) filter (where p.acc is not null),
    '{}'::text[]
  ) as amendment_types
from base b
left join periods p
  on p.cik = b.cik and p.period = b.period and p.amended and p.acc <> b.base_acc and p.filed >= b.base_filed
group by b.cik, b.period, b.base_acc, b.base_filed, b.base_is_amendment;
