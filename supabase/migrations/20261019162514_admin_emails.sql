-- SPEC F9 (v0.4.1): an account whose verified email is in ADMIN_EMAILS is organizer on every event.
-- Real event_staff rows, so requireStaffBySlug and record_scan step 3 apply unchanged. One statement:
-- the REST API caps a select at max_rows, so the app can't list every event itself.
create or replace function public.grant_admin_roles(p_user_id uuid)
returns int language plpgsql security definer set search_path = public, pg_temp as $$
declare n int;
begin
  insert into event_staff (event_id, user_id, role)
  select id, p_user_id, 'organizer' from events
  on conflict (event_id, user_id) do update set role = 'organizer';
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function public.grant_admin_roles(uuid) from public, anon, authenticated;
grant execute on function public.grant_admin_roles(uuid) to service_role;
