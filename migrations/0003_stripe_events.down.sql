-- Reverts 0003_stripe_events.up.sql. The delivery log goes with it; the
-- profile rows it wrote stay.
drop function if exists public.apply_stripe_event(text, text, uuid, jsonb, text);
drop table if exists public.stripe_events;
