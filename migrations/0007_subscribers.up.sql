-- S8 · Email subscribers without an account (the lead magnets).
--
-- subscribers   one row per address. A reader leaves an address for the
--               weekly newsletter, the quarterly report, an Excel list, the
--               portfolio matcher or one guru's new 13F; nothing is mailed to
--               it except the confirmation until they click the link in it
--               (double opt-in: status 'pending' → 'confirmed').
--
--   newsletter        the weekly "smart money" mail; opt-in, separate from
--                     the magnet itself (a download is not a subscription)
--   gurus             10-digit CIKs whose new 13F the reader wants by mail
--   guru_seen         per CIK, the newest filing date already mailed
--   magnets           what they asked for, so the welcome mail and the thanks
--                     page can hand it over again
--   confirm_token     single-use, cleared on confirmation
--   confirm_sends /   rate limit on confirmation mails to one address, so the
--   confirm_sent_at   form cannot be used to flood someone's inbox
--   unsub_token       in every mail's unsubscribe link; never changes
--   consent_*         what was agreed to, when, from where (KVKK / GDPR proof)
--
-- RLS on, no policies: only the service role (the API and the send job)
-- reads or writes. Neither anon nor authenticated can see a single address.

create table if not exists public.subscribers (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  lang text not null default 'tr',
  status text not null default 'pending',
  newsletter boolean not null default false,
  gurus jsonb not null default '[]'::jsonb,
  guru_seen jsonb not null default '{}'::jsonb,
  magnets jsonb not null default '[]'::jsonb,
  source text,
  confirm_token text,
  confirm_sent_at timestamptz,
  confirm_sends int not null default 0,
  unsub_token text not null,
  consent_at timestamptz,
  consent_ip text,
  consent_text text,
  confirmed_at timestamptz,
  unsubscribed_at timestamptz,
  newsletter_sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.subscribers drop constraint if exists subscribers_status_check;
alter table public.subscribers add constraint subscribers_status_check
  check (status in ('pending', 'confirmed', 'unsubscribed'));
alter table public.subscribers drop constraint if exists subscribers_lang_check;
alter table public.subscribers add constraint subscribers_lang_check check (lang in ('tr', 'en'));
alter table public.subscribers drop constraint if exists subscribers_email_check;
alter table public.subscribers add constraint subscribers_email_check
  check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' and length(email) <= 254);

create unique index if not exists subscribers_email_key on public.subscribers (email);
create unique index if not exists subscribers_confirm_token_key on public.subscribers (confirm_token) where confirm_token is not null;
create unique index if not exists subscribers_unsub_token_key on public.subscribers (unsub_token);
create index if not exists subscribers_newsletter on public.subscribers (status, newsletter);

comment on table public.subscribers is 'Lead-magnet subscribers without an account. Double opt-in (pending → confirmed); service role only.';

drop trigger if exists subscribers_touch on public.subscribers;
create trigger subscribers_touch
  before update on public.subscribers
  for each row execute function public.touch_updated_at();

alter table public.subscribers enable row level security;
revoke all on public.subscribers from anon, authenticated;
grant select, insert, update, delete on public.subscribers to service_role;
