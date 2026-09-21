-- S2 acceptance, run by scripts/db-test.sh after the migrations. Each block
-- impersonates an API request the way PostgREST does: set_config('role', …)
-- plus the JWT claims. The transaction-local settings vanish at the end of
-- each DO block, so every block starts as the migration user again.
\set ON_ERROR_STOP on
\set QUIET on

-- two accounts; the signup trigger makes their profiles
insert into auth.users (id, email) values
  ('00000000-0000-4000-8000-00000000000a', 'a@test.local'),
  ('00000000-0000-4000-8000-00000000000b', 'b@test.local');

do $$ begin
  if (select plan from public.profiles where id = '00000000-0000-4000-8000-00000000000a') <> 'free' then
    raise exception 'signup trigger must create the profile with plan = free';
  end if;
end $$;

-- 1. a user token cannot make itself Pro
do $$
declare state text;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
  begin
    update public.profiles set plan = 'pro' where id = auth.uid();
    raise exception 'FAIL: user updated its own plan';
  exception when insufficient_privilege then
    state := sqlstate;
  end;
  if state is distinct from '42501' then raise exception 'unexpected state %', state; end if;
  begin
    update public.profiles set plan_expires = now() + interval '10 years' where id = auth.uid();
    raise exception 'FAIL: user updated plan_expires';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set stripe_customer_id = 'cus_x' where id = auth.uid();
    raise exception 'FAIL: user updated stripe_customer_id';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set email = 'victim@else.test' where id = auth.uid();
    raise exception 'FAIL: user updated email';
  exception when insufficient_privilege then null;
  end;
  -- a no-op update on the own row is allowed (the policy exists)
  update public.profiles set plan = plan where id = auth.uid();
  raise notice 'ok  1. user token: plan/plan_expires/stripe_*/email updates raise 42501';
end $$;

-- 2. another user's rows are invisible: 0 rows, not an error
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
  insert into public.watchlists (user_id, cik, name) values (auth.uid(), '0001067983', 'Berkshire');
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
  select count(*) into n from public.profiles where id = '00000000-0000-4000-8000-00000000000b';
  if n <> 0 then raise exception 'FAIL: user A can read profile B'; end if;
  select count(*) into n from public.profiles;
  if n <> 1 then raise exception 'FAIL: user A sees % profiles', n; end if;
  select count(*) into n from public.watchlists where user_id = '00000000-0000-4000-8000-00000000000b';
  if n <> 0 then raise exception 'FAIL: user A can read watchlist B'; end if;
  update public.watchlists set name = 'x' where user_id = '00000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A updated watchlist B'; end if;
  delete from public.watchlists where user_id = '00000000-0000-4000-8000-00000000000b';
  get diagnostics n = row_count;
  if n <> 0 then raise exception 'FAIL: user A deleted watchlist B'; end if;
  begin
    insert into public.watchlists (user_id, cik, name) values ('00000000-0000-4000-8000-00000000000b', '0001350694', 'x');
    raise exception 'FAIL: user A inserted into watchlist B';
  exception when insufficient_privilege then null;  -- 42501: new row violates row-level security policy
  end;
  begin
    insert into public.profiles (id, email) values (gen_random_uuid(), 'x');
    raise exception 'FAIL: user inserted a profile';
  exception when insufficient_privilege then null;
  end;
  begin
    delete from public.profiles where id = auth.uid();
    raise exception 'FAIL: user deleted a profile';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok  2. other user''s profile/watchlist: 0 rows; profile insert/delete: 42501';
end $$;

-- 2b. the anon key has nothing here
do $$ begin
  perform set_config('role', 'anon', true);
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  begin
    perform * from public.profiles;
    raise exception 'FAIL: anon can select profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    update public.profiles set plan = 'pro';
    raise exception 'FAIL: anon can update profiles';
  exception when insufficient_privilege then null;
  end;
  begin
    perform * from public.watchlists;
    raise exception 'FAIL: anon can select watchlists';
  exception when insufficient_privilege then null;
  end;
  raise notice 'ok  2b. anon key: profiles/watchlists permission denied';
end $$;

-- 3. the service role can set the plan; is_pro follows
do $$
declare n int;
begin
  perform set_config('role', 'service_role', true);
  perform set_config('request.jwt.claims', '{"role":"service_role"}', true);
  update public.profiles set plan = 'pro', plan_expires = now() + interval '30 days' where id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: service role update touched % rows', n; end if;
  if not public.is_pro('00000000-0000-4000-8000-00000000000a') then raise exception 'FAIL: is_pro false after service update'; end if;
  if public.is_pro('00000000-0000-4000-8000-00000000000b') then raise exception 'FAIL: is_pro true for a free user'; end if;
  -- expired pro is not pro; NULL expiry is
  update public.profiles set plan_expires = now() - interval '1 minute' where id = '00000000-0000-4000-8000-00000000000a';
  if public.is_pro('00000000-0000-4000-8000-00000000000a') then raise exception 'FAIL: expired plan counted as pro'; end if;
  update public.profiles set plan_expires = null where id = '00000000-0000-4000-8000-00000000000a';
  if not public.is_pro('00000000-0000-4000-8000-00000000000a') then raise exception 'FAIL: null expiry must be pro'; end if;
  raise notice 'ok  3. service role: update succeeds; is_pro true / expired false / null expiry true';
end $$;

-- 3b. is_pro through a user token answers only about that user
do $$ begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
  if not public.is_pro() then raise exception 'FAIL: pro user sees is_pro() false'; end if;
  if public.is_pro('00000000-0000-4000-8000-00000000000b') then raise exception 'FAIL: leak'; end if;
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
  if public.is_pro() then raise exception 'FAIL: free user sees is_pro() true'; end if;
  if public.is_pro('00000000-0000-4000-8000-00000000000a') then raise exception 'FAIL: user B can see that A is pro'; end if;
  raise notice 'ok  3b. is_pro() with a user token: own answer only';
end $$;

-- 4. watchlist cap: free 10, pro 200; an upsert on an existing row is not growth;
--    a multi-row insert is judged on its total
do $$
declare n int;
begin
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000b","role":"authenticated"}', true);
  -- B (free) already has 1 row; fill to 10
  insert into public.watchlists (user_id, cik, name)
    select auth.uid(), lpad(g::text, 10, '0'), 'f' || g from generate_series(1, 9) g;
  select count(*) into n from public.watchlists where user_id = auth.uid();
  if n <> 10 then raise exception 'FAIL: expected 10 rows, got %', n; end if;
  begin
    insert into public.watchlists (user_id, cik, name) values (auth.uid(), '0000000099', 'one too many');
    raise exception 'FAIL: 11th row accepted on free';
  exception when raise_exception then
    if position('watchlist limit' in sqlerrm) = 0 then raise; end if;
  end;
  -- upsert of an existing row at the cap is fine
  insert into public.watchlists (user_id, cik, name) values (auth.uid(), '0001067983', 'Berkshire Hathaway')
    on conflict (user_id, cik) do update set name = excluded.name;
  begin
    insert into public.watchlists (user_id, cik, name)
      select auth.uid(), lpad((100 + g)::text, 10, '0'), 'bulk' || g from generate_series(1, 50) g;
    raise exception 'FAIL: bulk insert past the cap accepted';
  exception when raise_exception then
    if position('watchlist limit' in sqlerrm) = 0 then raise; end if;
  end;
  select count(*) into n from public.watchlists where user_id = auth.uid();
  if n <> 10 then raise exception 'FAIL: cap left % rows', n; end if;

  -- A (pro): 200 ok, 201 not
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
  insert into public.watchlists (user_id, cik, name)
    select auth.uid(), lpad(g::text, 10, '0'), 'p' || g from generate_series(1, 200) g;
  begin
    insert into public.watchlists (user_id, cik, name) values (auth.uid(), '0000000201', 'no');
    raise exception 'FAIL: 201st row accepted on pro';
  exception when raise_exception then
    if position('watchlist limit' in sqlerrm) = 0 then raise; end if;
  end;
  raise notice 'ok  4. watchlist cap: free 10 / pro 200, upsert at cap ok, bulk insert judged as a whole';
end $$;

-- 5. email change on auth.users reaches the profile
update auth.users set email = 'a2@test.local' where id = '00000000-0000-4000-8000-00000000000a';
do $$ begin
  if (select email from public.profiles where id = '00000000-0000-4000-8000-00000000000a') <> 'a2@test.local' then
    raise exception 'FAIL: profile email not synced';
  end if;
  raise notice 'ok  5. auth.users email change synced to profiles';
end $$;
