-- SPEC §6.5 / F14 (v0.9.2): optional Discord username and website on the hacker profile, shown on the badge
-- profile next to LinkedIn while sharing is on. Networking details like LinkedIn: no 30-day deletion, but the
-- tombstone clears them.

alter table participants
  add column discord_username text check (discord_username ~ '^[a-z0-9_.]{2,32}$'),
  add column website_url text check (website_url ~ '^https?://\S+$' and length(website_url) <= 300); -- 200 typed + https://, encoding

-- As in 20261026171328, with the two links appended (a missing value leaves the column, '' clears it).
drop function public._set_hacker_profile(uuid, text, boolean, text, text, text, text, text, text, text, text, text);
create function public._set_hacker_profile(
  p_participant_id uuid, p_linkedin_url text, p_public boolean, p_dietary_notes text,
  p_emergency_name text, p_emergency_phone text, p_emergency_relation text,
  p_overnight text default null, p_allergies text default null, p_allergy_severity text default null,
  p_team_status text default null, p_accessibility text default null,
  p_discord text default null, p_website text default null
) returns void language sql set search_path = public, pg_temp as $$
  update participants set
    linkedin_url = case when p_linkedin_url is null then linkedin_url else nullif(p_linkedin_url, '') end,
    linkedin_set_at = case when p_linkedin_url is not null and nullif(p_linkedin_url, '') is distinct from linkedin_url
                           then now() else linkedin_set_at end,
    profile_public = coalesce(p_public, profile_public),
    dietary_notes = case when p_dietary_notes is null then dietary_notes else nullif(p_dietary_notes, '') end,
    dietary_set_at = case when p_dietary_notes is not null and nullif(p_dietary_notes, '') is distinct from dietary_notes
                          then now() else dietary_set_at end,
    emergency_name = coalesce(p_emergency_name, emergency_name),
    emergency_phone = case when p_emergency_name is null then emergency_phone else p_emergency_phone end,
    emergency_relation = case when p_emergency_name is null then emergency_relation else nullif(p_emergency_relation, '') end,
    overnight = coalesce(p_overnight, overnight),
    allergies = case when p_allergies is null then allergies else nullif(p_allergies, '') end,
    allergy_severity = case when p_allergies is null then allergy_severity
                            when nullif(p_allergies, '') is null then null else p_allergy_severity end,
    team_status = coalesce(p_team_status, team_status),
    looking_for_team = case when p_team_status is not null and p_team_status is distinct from team_status and team_id is null
                            then p_team_status = 'looking' else looking_for_team end,
    accessibility = case when p_accessibility is null then accessibility else nullif(p_accessibility, '') end,
    discord_username = case when p_discord is null then discord_username else nullif(p_discord, '') end,
    website_url = case when p_website is null then website_url else nullif(p_website, '') end,
    updated_at = now()
  where id = p_participant_id
    and num_nonnulls(p_linkedin_url, p_public, p_dietary_notes, p_emergency_name, p_overnight, p_allergies, p_team_status,
                     p_accessibility, p_discord, p_website) > 0
$$;
revoke all on function public._set_hacker_profile(uuid, text, boolean, text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;

drop function public.save_hacker_profile(uuid, text, uuid, text, boolean, text, text, text, text, text, text, text, text, text);
create function public.save_hacker_profile(
  p_participant_id uuid, p_email text, p_user_id uuid,
  p_linkedin_url text default null, p_public boolean default null, p_dietary_notes text default null,
  p_emergency_name text default null, p_emergency_phone text default null, p_emergency_relation text default null,
  p_overnight text default null, p_allergies text default null, p_allergy_severity text default null,
  p_team_status text default null, p_accessibility text default null,
  p_discord text default null, p_website text default null
) returns boolean language plpgsql security definer set search_path = public, pg_temp as $$
declare ev uuid;
begin
  select pa.event_id into ev
    from participants pa join events e on e.id = pa.event_id
   where pa.id = p_participant_id and pa.email = lower(btrim(p_email)) and pa.status = 'accepted'
     and pa.deleted_at is null and e.ends_at > now() - interval '30 days'
     for update of pa;
  if not found then return false; end if;
  perform _set_hacker_profile(p_participant_id, p_linkedin_url, p_public, p_dietary_notes,
                              p_emergency_name, p_emergency_phone, p_emergency_relation,
                              p_overnight, p_allergies, p_allergy_severity, p_team_status, p_accessibility,
                              p_discord, p_website);
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (ev, p_user_id, 'participant', 'profile.update', p_participant_id, jsonb_strip_nulls(jsonb_build_object('public', p_public)));
  return true;
end $$;
revoke all on function public.save_hacker_profile(uuid, text, uuid, text, boolean, text, text, text, text, text, text, text, text, text, text, text) from public, anon, authenticated;
grant execute on function public.save_hacker_profile(uuid, text, uuid, text, boolean, text, text, text, text, text, text, text, text, text, text, text) to service_role;

-- As in 20261026172726, with the two links in what a shared profile shows.
create or replace function public.badge_profile(p_uid text, p_viewer_id uuid default null, p_viewer_email text default null)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with link as (
    select b.event_id, e.slug, pa.email, pa.first_name, pa.last_name, pa.linkedin_url, pa.discord_username,
           pa.website_url, pa.profile_public
      from badges b
      join participants pa on pa.id = b.participant_id
      join events e on e.id = b.event_id
     where b.uid = p_uid and pa.deleted_at is null and pa.status = 'accepted'
       and e.ends_at > now() - interval '30 days'
     order by b.linked_at desc
     limit 1
  )
  select case
           when l.profile_public
             then jsonb_build_object('allowed', true, 'public', true, 'firstName', l.first_name,
                                     'lastName', l.last_name, 'linkedinUrl', l.linkedin_url,
                                     'discord', l.discord_username, 'websiteUrl', l.website_url)
           else jsonb_build_object('allowed', true, 'public', false)
         end
         || case when l.email = lower(btrim(p_viewer_email)) then jsonb_build_object('self', true, 'slug', l.slug)
                 else '{}'::jsonb end
    from link l
$$;
revoke all on function public.badge_profile(text, uuid, text) from public, anon, authenticated;
grant execute on function public.badge_profile(text, uuid, text) to service_role;

-- As in 20261026171328, also clearing the two links.
create or replace function public.delete_participant(p_event_id uuid, p_participant_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype;
begin
  select * into pa from participants where id = p_participant_id and event_id = p_event_id for update;
  if not found then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  if pa.deleted_at is not null then return jsonb_build_object('code', 'ALREADY_DELETED'); end if;
  update participants
     set deleted_at = now(), first_name = 'Deleted', last_name = '', email = 'deleted+' || id || '@invalid',
         search_text = '', dietary_notes = null, linkedin_url = null, photo_path = null, photo_updated_at = null,
         emergency_name = null, emergency_phone = null, emergency_relation = null,
         overnight = null, allergies = null, allergy_severity = null, team_status = null, accessibility = null,
         discord_username = null, website_url = null,
         team_id = null, looking_for_team = false,
         updated_at = now()
   where id = pa.id;
  update passes set revoked_at = now(), revoke_reason = 'deleted' where participant_id = pa.id and revoked_at is null;
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = pa.id and status in ('pending', 'sending');
  delete from badges where participant_id = pa.id;
  delete from team_invites where participant_id = pa.id;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'participant.delete', pa.id);
  return jsonb_build_object('code', 'DELETED', 'photoPath', pa.photo_path);
end $$;
revoke all on function public.delete_participant(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_participant(uuid, uuid, uuid) to service_role;
