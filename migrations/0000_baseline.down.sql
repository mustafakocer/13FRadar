-- Local reset only. Running this on the live project deletes every account
-- row; there is no reason to ever do that.
drop trigger if exists on_auth_user_created on auth.users;
drop function if exists public.handle_new_user();
drop table if exists public.watchlists;
drop table if exists public.profiles;
