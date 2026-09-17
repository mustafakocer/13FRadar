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
