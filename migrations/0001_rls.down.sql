-- Reverts 0001_rls.up.sql to the baseline policies. No data changes.
drop trigger if exists watchlists_10_cap on public.watchlists;
drop function if exists public.watchlists_enforce_cap();
drop function if exists public.watchlists_cap_pro();
drop function if exists public.watchlists_cap();

drop policy if exists watchlists_select_own on public.watchlists;
drop policy if exists watchlists_insert_own on public.watchlists;
drop policy if exists watchlists_update_own on public.watchlists;
drop policy if exists watchlists_delete_own on public.watchlists;
grant all on public.watchlists to anon;
create policy "own watchlist" on public.watchlists
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop trigger if exists on_auth_user_email_changed on auth.users;
drop function if exists public.handle_user_email_change();

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email) values (new.id, new.email);
  return new;
end $$;

drop trigger if exists profiles_guard_columns on public.profiles;
drop function if exists public.profiles_guard_columns();

drop policy if exists profiles_update_own on public.profiles;
drop policy if exists profiles_select_own on public.profiles;
grant all on public.profiles to anon;
grant insert, delete on public.profiles to authenticated;
create policy "read own profile" on public.profiles for select using (auth.uid() = id);

drop function if exists public.is_pro(uuid);
