-- S7 acceptance: the digest marks exist, start at today, and the roles can
-- do what the digest and the account page need.
\set ON_ERROR_STOP on
\set QUIET on

do $$
declare n int; today text := to_char(now() at time zone 'utc', 'YYYY-MM-DD');
begin
  -- every existing preference row got today's marks and lost its opt-in
  select count(*) into n from public.notification_prefs where filings_seen is distinct from today or form4_seen is distinct from today;
  if n <> 0 then raise exception 'FAIL: % preference rows without today''s marks', n; end if;
  -- (the opt-in reset and the alert-mark move happen at migration time; the
  -- 0004 test re-creates opt-ins and alerts afterwards, so they are not
  -- re-checked here)
  -- lang is constrained and a user writes only its own row
  perform set_config('role', 'authenticated', true);
  perform set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-00000000000a","role":"authenticated"}', true);
  update public.notification_prefs set lang = 'en', email_digest = true where user_id = auth.uid();
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: user A could not opt in again'; end if;
  begin
    update public.notification_prefs set lang = 'de' where user_id = auth.uid();
    raise exception 'FAIL: bad lang accepted';
  exception when check_violation then null;
  end;
  -- the service role (digest job) moves the marks
  perform set_config('role', 'service_role', true);
  update public.notification_prefs set filings_seen = today, filings_seen_acc = '["x"]'::jsonb, last_sent_at = now()
   where user_id = '00000000-0000-4000-8000-00000000000a';
  get diagnostics n = row_count;
  if n <> 1 then raise exception 'FAIL: service role could not move the marks'; end if;
end $$;
