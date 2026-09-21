-- Reverts 0002_constraints.up.sql. The CIK padding and the dropped duplicate
-- rows are not undone (they were data repairs, and the padded form is what
-- the site uses anyway). ls_customer_id comes back empty.
alter table public.watchlists drop constraint if exists watchlists_cik_check;
drop trigger if exists watchlists_00_normalize_cik on public.watchlists;
drop function if exists public.watchlists_normalize_cik();

drop index if exists public.profiles_stripe_subscription_id_key;
drop index if exists public.profiles_stripe_customer_id_key;

alter table public.profiles add column if not exists ls_customer_id text;

comment on column public.profiles.plan_expires is null;
comment on column public.profiles.plan is null;
alter table public.profiles drop constraint if exists profiles_plan_check;
