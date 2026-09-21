-- S3 acceptance: constraints and CIK normalisation.
\set ON_ERROR_STOP on
\set QUIET on

insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000c', 'c@test.local');

do $$ begin
  begin
    update public.profiles set plan = 'enterprise' where id = '00000000-0000-4000-8000-00000000000c';
    raise exception 'FAIL: plan outside free/pro accepted';
  exception when check_violation then null;
  end;
  if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = 'profiles' and column_name = 'ls_customer_id') then
    raise exception 'FAIL: ls_customer_id still present';
  end if;
  raise notice 'ok  6. plan CHECK (free|pro); ls_customer_id dropped';
end $$;

do $$ begin
  update public.profiles set stripe_customer_id = 'cus_1', stripe_subscription_id = 'sub_1' where id = '00000000-0000-4000-8000-00000000000a';
  begin
    update public.profiles set stripe_customer_id = 'cus_1' where id = '00000000-0000-4000-8000-00000000000b';
    raise exception 'FAIL: duplicate stripe_customer_id accepted';
  exception when unique_violation then null;
  end;
  begin
    update public.profiles set stripe_subscription_id = 'sub_1' where id = '00000000-0000-4000-8000-00000000000b';
    raise exception 'FAIL: duplicate stripe_subscription_id accepted';
  exception when unique_violation then null;
  end;
  -- several NULLs are fine
  update public.profiles set stripe_customer_id = null, stripe_subscription_id = null where id in ('00000000-0000-4000-8000-00000000000b', '00000000-0000-4000-8000-00000000000c');
  raise notice 'ok  7. stripe_customer_id / stripe_subscription_id UNIQUE (nulls free)';
end $$;

do $$
declare c text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000c","role":"authenticated"}', true);
  insert into public.watchlists (user_id, cik, name) values (auth.uid(), '1067983', 'unpadded');
  select cik into c from public.watchlists where user_id = auth.uid();
  if c <> '0001067983' then raise exception 'FAIL: cik stored as %', c; end if;
  -- the padded form is the same row: upsert, not a second one
  insert into public.watchlists (user_id, cik, name) values (auth.uid(), ' 0001067983 ', 'padded')
    on conflict (user_id, cik) do update set name = excluded.name;
  if (select count(*) from public.watchlists where user_id = auth.uid()) <> 1 then
    raise exception 'FAIL: padded and unpadded CIK became two rows';
  end if;
  if (select name from public.watchlists where user_id = auth.uid()) <> 'padded' then
    raise exception 'FAIL: upsert did not update the row';
  end if;
  begin
    insert into public.watchlists (user_id, cik, name) values (auth.uid(), 'BRK', 'not a cik');
    raise exception 'FAIL: non-numeric cik accepted';
  exception when check_violation then null;
  end;
  begin
    insert into public.watchlists (user_id, cik, name) values (auth.uid(), '12345678901', 'eleven digits');
    raise exception 'FAIL: 11-digit cik accepted';
  exception when check_violation then null;
  end;
  raise notice 'ok  8. watchlists.cik: padded on insert, CHECK ^[0-9]{10}$';
end $$;

-- 9. the repair statements in 0002 on rows an older client wrote unpadded:
--    seed them with the guards off, re-run the (idempotent) migration
alter table public.watchlists drop constraint watchlists_cik_check;
alter table public.watchlists disable trigger watchlists_00_normalize_cik;
insert into auth.users (id, email) values ('00000000-0000-4000-8000-00000000000d', 'd@test.local');
insert into public.watchlists (user_id, cik, name, created_at) values
  ('00000000-0000-4000-8000-00000000000d', '0001067983', 'padded', now()),
  ('00000000-0000-4000-8000-00000000000d', '1067983', 'unpadded duplicate', now() + interval '1 minute'),
  ('00000000-0000-4000-8000-00000000000d', '1350694', 'unpadded only', now()),
  ('00000000-0000-4000-8000-00000000000d', '01350694', 'unpadded twice', now() + interval '1 minute');
\i migrations/0002_constraints.up.sql
do $$
declare rows text;
begin
  select string_agg(cik || '=' || name, '; ' order by cik) into rows
    from public.watchlists where user_id = '00000000-0000-4000-8000-00000000000d';
  if rows <> '0001067983=padded; 0001350694=unpadded only' then
    raise exception 'FAIL: repair left %', rows;
  end if;
  raise notice 'ok  9. migration repairs unpadded rows: duplicates dropped, rest padded, CHECK back on';
end $$;
