-- SPEC F9/F12 (v0.4): what "Forgot password" may send. 'reset' when an account exists; 'invite' when the
-- address has no account yet but is an accepted participant or has a staff invite; otherwise 'none'.
create or replace function public.password_link_kind(p_email text)
returns text language sql stable security definer set search_path = public, pg_temp as $$
  select case
    when exists (select 1 from auth.users u where lower(u.email) = lower(btrim(p_email))) then 'reset'
    when exists (select 1 from participants p
                  where p.email = lower(btrim(p_email)) and p.status = 'accepted' and p.deleted_at is null)
      or exists (select 1 from staff_invites i where i.email = lower(btrim(p_email))) then 'invite'
    else 'none'
  end
$$;
revoke all on function public.password_link_kind(text) from public, anon, authenticated;
grant execute on function public.password_link_kind(text) to service_role;
