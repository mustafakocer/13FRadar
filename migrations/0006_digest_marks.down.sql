-- Reverts 0006_digest_marks.up.sql: the per-reader digest columns go; the
-- opt-in reset and the moved alert marks are not undone (there is nothing
-- to restore them from, and leaving them is the safe side). The signup
-- trigger goes back to the 0004 version.
alter table public.notification_prefs drop constraint if exists notification_prefs_lang_check;
alter table public.notification_prefs
  drop column if exists lang,
  drop column if exists filings_seen,
  drop column if exists filings_seen_acc,
  drop column if exists form4_seen,
  drop column if exists last_sent_at;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, plan)
  values (new.id, new.email, 'free')
  on conflict (id) do nothing;
  insert into public.notification_prefs (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end $$;
