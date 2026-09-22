-- Reverts 0004_alerts.up.sql: the two tables go with their rows; the signup
-- trigger goes back to the 0001 form (profile only). is_pro() and the
-- watchlist objects are untouched.
drop trigger if exists alerts_05_cap on public.alerts;
drop function if exists public.alerts_enforce_cap();
drop function if exists public.alerts_cap_pro();
drop function if exists public.alerts_cap();
drop trigger if exists alerts_00_normalize_target on public.alerts;
drop function if exists public.alerts_normalize_target();
drop table if exists public.alerts;

drop trigger if exists notification_prefs_touch on public.notification_prefs;
drop function if exists public.touch_updated_at();
drop table if exists public.notification_prefs;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, plan)
  values (new.id, new.email, 'free')
  on conflict (id) do nothing;
  return new;
end $$;
