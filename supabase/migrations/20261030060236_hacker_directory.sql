-- SPEC F16 / S13: private, event-scoped opt-in directory. Badge sharing is independent.
alter table participants
  add column directory_opt_in boolean not null default false,
  add column bio text check (length(bio) between 1 and 280),
  add column pace text check (pace in ('competitive', 'balanced', 'casual'));

drop function public._set_hacker_profile(uuid, text, boolean, text, text, text, text, text, text, text, text, text, text, text);
create function public._set_hacker_profile(
  p_participant_id uuid, p_linkedin_url text, p_public boolean, p_dietary_notes text,
  p_emergency_name text, p_emergency_phone text, p_emergency_relation text,
  p_overnight text default null, p_allergies text default null, p_allergy_severity text default null,
  p_team_status text default null, p_accessibility text default null,
  p_discord text default null, p_website text default null,
  p_directory_opt_in boolean default null, p_bio text default null, p_pace text default null
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
    directory_opt_in = coalesce(p_directory_opt_in, directory_opt_in),
    bio = case when p_bio is null then bio else nullif(p_bio, '') end,
    pace = case when p_pace is null then pace else nullif(p_pace, '') end,
    updated_at = now()
  where id = p_participant_id
    and num_nonnulls(p_linkedin_url, p_public, p_dietary_notes, p_emergency_name, p_overnight, p_allergies, p_team_status,
                     p_accessibility, p_discord, p_website, p_directory_opt_in, p_bio, p_pace) > 0
$$;
revoke all on function public._set_hacker_profile(uuid, text, boolean, text, text, text, text, text, text, text, text, text, text, text, boolean, text, text) from public, anon, authenticated;

drop function public.save_hacker_profile(uuid, text, uuid, text, boolean, text, text, text, text, text, text, text, text, text, text, text);
create function public.save_hacker_profile(
  p_participant_id uuid, p_email text, p_user_id uuid,
  p_linkedin_url text default null, p_public boolean default null, p_dietary_notes text default null,
  p_emergency_name text default null, p_emergency_phone text default null, p_emergency_relation text default null,
  p_overnight text default null, p_allergies text default null, p_allergy_severity text default null,
  p_team_status text default null, p_accessibility text default null,
  p_discord text default null, p_website text default null,
  p_directory_opt_in boolean default null, p_bio text default null, p_pace text default null
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
                              p_discord, p_website, p_directory_opt_in, p_bio, p_pace);
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (ev, p_user_id, 'participant', 'profile.update', p_participant_id, jsonb_strip_nulls(jsonb_build_object('public', p_public, 'directoryOptIn', p_directory_opt_in)));
  return true;
end $$;
revoke all on function public.save_hacker_profile(uuid, text, uuid, text, boolean, text, text, text, text, text, text, text, text, text, text, text, boolean, text, text) from public, anon, authenticated;
grant execute on function public.save_hacker_profile(uuid, text, uuid, text, boolean, text, text, text, text, text, text, text, text, text, text, text, boolean, text, text) to service_role;

grant execute on function public._set_hacker_profile(uuid, text, boolean, text, text, text, text, text, text, text, text, text, text, text, boolean, text, text) to service_role;

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
         directory_opt_in = false, bio = null, pace = null,
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


-- The email and event are server-derived after myEvent; verify them again in the database.
create function public.hacker_directory(p_event_id uuid, p_email text, p_looking boolean default false)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select coalesce(jsonb_agg(entry order by name, id), '[]'::jsonb) from (
    select pa.id, concat_ws(' ', pa.first_name, nullif(pa.last_name, '')) as name,
      jsonb_build_object('id', pa.id, 'name', concat_ws(' ', pa.first_name, nullif(pa.last_name, '')))
      || case when pa.directory_opt_in then jsonb_build_object(
        'bio', pa.bio, 'pace', pa.pace, 'teamName', t.name,
        'looking', pa.looking_for_team and pa.team_id is null,
        'linkedinUrl', pa.linkedin_url, 'discord', pa.discord_username, 'websiteUrl', pa.website_url
      ) else '{}'::jsonb end as entry
    from participants pa
    left join teams t on t.id = pa.team_id and t.event_id = pa.event_id
    where pa.event_id = p_event_id and pa.status = 'accepted' and pa.deleted_at is null
      and (pa.directory_opt_in or (p_looking and pa.looking_for_team and pa.team_id is null))
      and (not p_looking or (pa.looking_for_team and pa.team_id is null))
      and exists (
        select 1 from participants viewer join events e on e.id = viewer.event_id
        where viewer.event_id = p_event_id and viewer.email = lower(btrim(p_email))
          and viewer.status = 'accepted' and viewer.deleted_at is null
          and e.ends_at > now() - interval '30 days'
      )
    order by name, pa.id
    -- shortcut: cap each filtered directory at 500; add pagination if an event grows beyond this.
    limit 500
  ) people
$$;
revoke all on function public.hacker_directory(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.hacker_directory(uuid, text, boolean) to service_role;
