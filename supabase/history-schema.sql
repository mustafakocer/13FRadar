-- Historical 13F and Form 4 storage.
--
-- The site ships its datasets as JSON files committed by GitHub Actions, which
-- works because each one is a window: the latest quarter of the curated funds,
-- a year of insider transactions, a rolling feed of filings. Depth is what
-- that shape cannot carry — thirteen years of holdings for thirteen thousand
-- filers is tens of gigabytes, and a serverless bundle cannot hold it.
--
-- These tables are that depth. Nothing reads them until they are populated:
-- the read path checks for a configured store and falls back to the files, so
-- the site behaves identically before, during and after a backfill.
--
-- Apply with: psql "$DATABASE_URL" -f supabase/history-schema.sql
--
-- Status (2026-09-21): NOT applied to the production project. The live
-- public schema holds only the account tables (see migrations/); every 13F
-- dataset the site serves is a JSON file committed by GitHub Actions
-- (docs/SUPABASE.md lists them). Nothing here is a migration of live data.

create table if not exists public.filers (
  cik text primary key,
  name text not null,
  state text,
  city text,
  first_filed date,
  last_filed date,
  updated_at timestamptz not null default now()
);

-- One row per 13F filing. `report_date` is the period covered and `filed` the
-- date it arrived; an amendment is its own row, sharing report_date with the
-- filing it restates, which is why the primary key is the accession.
create table if not exists public.filings (
  acc text primary key,
  cik text not null references public.filers (cik) on delete cascade,
  form text not null,
  amended boolean not null default false,
  report_date date,
  filed date not null,
  -- as computed from the info table, so a page can show the filing's own
  -- totals without reading every position back
  aum numeric,
  positions integer,
  unit_fix boolean not null default false,
  ingested_at timestamptz not null default now()
);
create index if not exists filings_cik_report on public.filings (cik, report_date desc);
create index if not exists filings_filed on public.filings (filed desc);
create index if not exists filings_report on public.filings (report_date desc);

-- 13F-HR/A support. Raw filings stay one row per accession (the audit
-- trail). Two columns carry what the cover page says — the period the
-- document itself reports, and for an amendment whether it restates the
-- table or adds to it. Both are added here rather than in a separate
-- migration because this whole schema is opt-in and not yet applied
-- anywhere: there is no live table to migrate.
alter table public.filings
  add column if not exists period_of_report date,
  add column if not exists amendment_type text
    check (amendment_type is null or amendment_type in ('RESTATEMENT', 'NEW HOLDINGS'));
comment on column public.filings.period_of_report is
  'periodOfReport from the filing''s own cover page; report_date is the index-derived value';
comment on column public.filings.amendment_type is
  '13F-HR/A only: RESTATEMENT replaces the original table, NEW HOLDINGS is added to it';
create index if not exists filings_cik_period
  on public.filings (cik, coalesce(period_of_report, report_date) desc, filed);

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

-- One row per position per filing. This is the large table: ~2.2M positions a
-- quarter across the whole universe, so about 115M rows for 2013 onward.
-- Partitioning by report_date keeps a quarter's read off the rest.
create table if not exists public.holdings (
  acc text not null references public.filings (acc) on delete cascade,
  cusip text not null,
  put_call text not null default '',
  issuer text,
  class text,
  value numeric not null,
  shares numeric not null,
  weight real,
  primary key (acc, cusip, put_call)
);
create index if not exists holdings_cusip on public.holdings (cusip);

-- Ticker resolution is a property of the security, not of a filing, so it
-- lives once rather than on 115M rows.
create table if not exists public.securities (
  cusip text primary key,
  ticker text,
  issuer text,
  sector text,
  updated_at timestamptz not null default now()
);
create index if not exists securities_ticker on public.securities (ticker);

-- Form 4 transactions. The JSON window holds a year; this holds all of them.
create table if not exists public.insider_trades (
  acc text not null,
  seq integer not null,
  ticker text,
  issuer_cik text,
  insider text,
  role text,
  title text,
  trans_date date,
  filed date,
  code text,
  shares numeric,
  price numeric,
  value numeric,
  owned_after numeric,
  own_change real,
  planned boolean not null default false,
  class text,
  primary key (acc, seq)
);
create index if not exists insider_ticker_date on public.insider_trades (ticker, trans_date desc);
create index if not exists insider_filed on public.insider_trades (filed desc);

-- Where each backfill got to, so a run that stops halfway is resumed rather
-- than restarted. One row per job ('13f', 'form4'), holding the oldest period
-- reached and whatever bookkeeping that job needs.
create table if not exists public.backfill_state (
  job text primary key,
  cursor text,
  done boolean not null default false,
  stats jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
