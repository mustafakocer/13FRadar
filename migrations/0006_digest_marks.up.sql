-- S7 · Email digest, second attempt (docs/EMAIL_ALERTS.md).
--
-- The digest now follows the reader's watchlist: a new 13F from any fund on
-- it, and the Form 4 trades a watched guru itself files. Nothing has to be
-- saved as an "alert" first. That needs a high-water mark per reader rather
-- than per alert row, so notification_prefs grows:
--
--   lang               the language the mail is written in ('tr' | 'en'),
--                      set by the account page from the UI language
--   filings_seen       the newest filing date already reported (YYYY-MM-DD);
--                      that day is re-read, the accessions below de-duplicate
--   filings_seen_acc   accessions reported on that day
--   form4_seen         the newest Form 4 filing date already reported
--   last_sent_at       when the reader last got a digest (weekly cadence)
--
-- Backlog guard: everything that accumulated while the feature was off would
-- go out in one mail on the first run. The marks start at today, so the first
-- digest carries today's filings at most. The old per-alert marks get the
-- same treatment.
--
-- Consent: opt-ins given before the feature was removed (2026-09) were
-- given under a different promise. They are reset; the account page asks
-- again. Nobody gets mail until they tick the box after this migration.

alter table public.notification_prefs
  add column if not exists lang text not null default 'tr',
  add column if not exists filings_seen text,
  add column if not exists filings_seen_acc jsonb not null default '[]'::jsonb,
  add column if not exists form4_seen text,
  add column if not exists last_sent_at timestamptz;

alter table public.notification_prefs drop constraint if exists notification_prefs_lang_check;
alter table public.notification_prefs add constraint notification_prefs_lang_check
  check (lang in ('tr', 'en'));

comment on column public.notification_prefs.filings_seen is 'Digest high-water mark: newest 13F filing date already reported to this reader.';
comment on column public.notification_prefs.filings_seen_acc is 'Accessions already reported on filings_seen, so re-reading that day repeats nothing.';
comment on column public.notification_prefs.form4_seen is 'Digest high-water mark: newest Form 4 filing date already reported.';
comment on column public.notification_prefs.last_sent_at is 'When the last digest went to this reader; the weekly cadence counts from here.';

-- start the marks today: nothing older than this migration is ever mailed
update public.notification_prefs
   set filings_seen = to_char(now() at time zone 'utc', 'YYYY-MM-DD'),
       form4_seen = to_char(now() at time zone 'utc', 'YYYY-MM-DD')
 where filings_seen is null;

update public.alerts
   set last_seen = to_char(now() at time zone 'utc', 'YYYY-MM-DD')
 where last_seen is null or last_seen < to_char(now() at time zone 'utc', 'YYYY-MM-DD');

-- re-consent
update public.notification_prefs set email_digest = false where email_digest;

-- a new account's row starts with today's marks too
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, plan)
  values (new.id, new.email, 'free')
  on conflict (id) do nothing;
  insert into public.notification_prefs (user_id, filings_seen, form4_seen)
  values (new.id, to_char(now() at time zone 'utc', 'YYYY-MM-DD'), to_char(now() at time zone 'utc', 'YYYY-MM-DD'))
  on conflict (user_id) do nothing;
  return new;
end $$;
