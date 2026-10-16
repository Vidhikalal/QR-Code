-- SPEC §6.5 (v0.3): opt-in badge profile. Additive: every existing participant starts not shared.
alter table participants add column profile_public boolean not null default false;

-- The privacy filter lives here, not in the page: only opted-in fields ever leave the database,
-- and never email, dietary notes, status or photo. Newest live link wins (a badge reused at a
-- later event shows its current holder). Null when the badge isn't linked.
create or replace function public.badge_profile(p_uid text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select case when pa.profile_public
           then jsonb_build_object('public', true, 'firstName', pa.first_name, 'lastName', pa.last_name,
                                   'linkedinUrl', pa.linkedin_url)
           else jsonb_build_object('public', false) end
    from badges b
    join participants pa on pa.id = b.participant_id
   where b.uid = p_uid and pa.deleted_at is null
   order by b.linked_at desc
   limit 1
$$;
revoke all on function public.badge_profile(text) from public, anon, authenticated;
grant execute on function public.badge_profile(text) to service_role;

-- PATCH /api/pass: the pass holder switches the profile on or off. Audited without PII (I-11).
create or replace function public.set_profile_public(p_participant_id uuid, p_public boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
declare ev uuid;
begin
  update participants set profile_public = p_public, updated_at = now()
   where id = p_participant_id
  returning event_id into ev;
  insert into audit_log (event_id, actor_kind, action, subject_id, detail)
  values (ev, 'participant', 'profile.visibility', p_participant_id, jsonb_build_object('public', p_public));
end $$;
revoke all on function public.set_profile_public(uuid, boolean) from public, anon, authenticated;
grant execute on function public.set_profile_public(uuid, boolean) to service_role;

-- Same signature as 20260924053521_pass_page.sql, plus the opt-in state for the pass page.
create or replace function public.pass_lookup(p_token_hash text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'pass', jsonb_build_object('id', ps.id, 'revokedAt', ps.revoked_at, 'revokeReason', ps.revoke_reason),
    'participant', jsonb_build_object(
      'id', pa.id, 'eventId', pa.event_id, 'firstName', pa.first_name, 'status', pa.status,
      'deleted', pa.deleted_at is not null, 'photoPath', pa.photo_path, 'photoUpdatedAt', pa.photo_updated_at,
      'profilePublic', pa.profile_public, 'hasLinkedin', pa.linkedin_url is not null),
    'event', jsonb_build_object('name', e.name, 'venue', e.venue, 'startsAt', e.starts_at, 'timezone', e.timezone),
    'checkedIn', exists (
      select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
       where s.participant_id = pa.id and c.kind = 'door' and s.voided_at is null))
    from passes ps
    join participants pa on pa.id = ps.participant_id
    join events e on e.id = pa.event_id
   where ps.token_hash = p_token_hash
$$;
revoke all on function public.pass_lookup(text) from public, anon, authenticated;
grant execute on function public.pass_lookup(text) to service_role;
