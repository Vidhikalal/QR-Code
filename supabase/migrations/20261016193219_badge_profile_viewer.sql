-- SPEC §6.5 (v0.3, DECISION change): badge profiles are only shown to a signed-in viewer who is an
-- accepted attendee (matched by their verified email) or staff of the badge's event. Anyone else
-- gets {allowed:false} and nothing about the holder. Replaces badge_profile(text).
drop function if exists public.badge_profile(text);

create or replace function public.badge_profile(p_uid text, p_viewer_id uuid, p_viewer_email text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with link as (
    select b.event_id, pa.first_name, pa.last_name, pa.linkedin_url, pa.profile_public
      from badges b
      join participants pa on pa.id = b.participant_id
      join events e on e.id = b.event_id
     where b.uid = p_uid and pa.deleted_at is null and pa.status = 'accepted'
       and e.ends_at > now() - interval '30 days'
     order by b.linked_at desc
     limit 1
  )
  select case
           when not (exists (select 1 from participants v
                              where v.event_id = l.event_id and v.email = lower(btrim(p_viewer_email))
                                and v.status = 'accepted' and v.deleted_at is null)
                     or exists (select 1 from event_staff s where s.event_id = l.event_id and s.user_id = p_viewer_id))
             then jsonb_build_object('allowed', false)
           when l.profile_public
             then jsonb_build_object('allowed', true, 'public', true, 'firstName', l.first_name,
                                     'lastName', l.last_name, 'linkedinUrl', l.linkedin_url)
           else jsonb_build_object('allowed', true, 'public', false)
         end
    from link l
$$;
revoke all on function public.badge_profile(text, uuid, text) from public, anon, authenticated;
grant execute on function public.badge_profile(text, uuid, text) to service_role;
