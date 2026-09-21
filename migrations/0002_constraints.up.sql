-- S3 · Schema cleanup and constraints on the account tables.
--
-- plan                 CHECK in ('free', 'pro'). Pre-check aborts, naming the
--                      offending values, rather than rewriting anyone's row.
-- plan_expires         NULL with plan = 'pro' means an open-ended grant
--                      (manual or lifetime); is_pro() treats it as active.
--                      Stripe-driven rows always carry current_period_end.
-- ls_customer_id       Dropped: nothing in the repository reads or writes it
--                      (Lemon Squeezy was never wired up).
-- stripe_customer_id,  UNIQUE (partial, non-null): one Stripe customer and one
-- stripe_subscription_id  subscription map to one account. Pre-check aborts
--                      on duplicates.
-- watchlists.cik       Always the 10-digit zero-padded form the site uses
--                      (client/src/lib/paths.js pads the same way). Existing
--                      rows are normalised, an unpadded duplicate of a padded
--                      row is dropped, a BEFORE trigger pads what arrives, and
--                      a CHECK rejects anything that is not ten digits.

-- ------------------------------------------------------------------ plan ---
do $$
declare bad text;
begin
  select string_agg(distinct coalesce(plan, '<null>'), ', ') into bad
    from public.profiles where plan is null or plan not in ('free', 'pro');
  if bad is not null then
    raise exception 'profiles.plan holds values outside free/pro: %. Inspect with: select id, email, plan from public.profiles where plan is null or plan not in (''free'',''pro'');', bad;
  end if;
end $$;

alter table public.profiles alter column plan set default 'free';
alter table public.profiles alter column plan set not null;
alter table public.profiles drop constraint if exists profiles_plan_check;
alter table public.profiles add constraint profiles_plan_check check (plan in ('free', 'pro'));

comment on column public.profiles.plan is 'free | pro. Written by the server only (Stripe webhook via apply_stripe_event, or a manual grant in SQL).';
comment on column public.profiles.plan_expires is 'End of the paid period (Stripe current_period_end). NULL with plan = pro is an open-ended grant: is_pro() counts it as active.';

-- -------------------------------------------------------- ls_customer_id ---
alter table public.profiles drop column if exists ls_customer_id;

-- ------------------------------------------------------------ stripe ids ---
do $$
declare dup text;
begin
  select string_agg(stripe_customer_id, ', ') into dup from (
    select stripe_customer_id from public.profiles
     where stripe_customer_id is not null group by 1 having count(*) > 1) d;
  if dup is not null then
    raise exception 'stripe_customer_id shared by several profiles: %', dup;
  end if;
  select string_agg(stripe_subscription_id, ', ') into dup from (
    select stripe_subscription_id from public.profiles
     where stripe_subscription_id is not null group by 1 having count(*) > 1) d;
  if dup is not null then
    raise exception 'stripe_subscription_id shared by several profiles: %', dup;
  end if;
end $$;

create unique index if not exists profiles_stripe_customer_id_key
  on public.profiles (stripe_customer_id) where stripe_customer_id is not null;
create unique index if not exists profiles_stripe_subscription_id_key
  on public.profiles (stripe_subscription_id) where stripe_subscription_id is not null;

-- --------------------------------------------------------- watchlists.cik ---
-- 1. a row whose padded form already exists (or exists in a better-padded
--    form) for the same user goes; the earliest-created canonical row stays
delete from public.watchlists w
 where w.cik !~ '^[0-9]{10}$'
   and exists (
     select 1 from public.watchlists o
      where o.user_id = w.user_id
        and o.cik <> w.cik
        and lpad(btrim(o.cik), 10, '0') = lpad(btrim(w.cik), 10, '0')
        and (o.cik ~ '^[0-9]{10}$'
             or o.created_at < w.created_at
             or (o.created_at = w.created_at and o.cik < w.cik)));

-- 2. pad what is left
update public.watchlists
   set cik = lpad(btrim(cik), 10, '0')
 where cik !~ '^[0-9]{10}$' and btrim(cik) ~ '^[0-9]{1,10}$';

-- 3. anything still not ten digits is not a CIK; say which and stop
do $$
declare bad text;
begin
  select string_agg(format('%s/%L', user_id, cik), ', ') into bad
    from public.watchlists where cik !~ '^[0-9]{10}$';
  if bad is not null then
    raise exception 'watchlists.cik values that are not a CIK: %', bad;
  end if;
end $$;

create or replace function public.watchlists_normalize_cik()
returns trigger language plpgsql as $$
begin
  new.cik := btrim(new.cik);
  if new.cik ~ '^[0-9]{1,10}$' then
    new.cik := lpad(new.cik, 10, '0');
  end if;
  return new;
end $$;

-- runs before watchlists_10_cap (triggers fire in name order)
drop trigger if exists watchlists_00_normalize_cik on public.watchlists;
create trigger watchlists_00_normalize_cik
  before insert or update of cik on public.watchlists
  for each row execute function public.watchlists_normalize_cik();

alter table public.watchlists drop constraint if exists watchlists_cik_check;
alter table public.watchlists add constraint watchlists_cik_check check (cik ~ '^[0-9]{10}$');
