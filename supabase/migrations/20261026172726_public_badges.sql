-- SPEC §6.5 (v0.9): badge profiles are public. Anyone who taps a badge sees what its holder shares, without
-- signing in (reverses the v0.3 DECISION), and sharing is on by default. Never email, dietary notes,
-- allergies, status or photo. The viewer is still passed in, so the holder tapping their own badge opens
-- their menu.

alter table participants alter column profile_public set default true;

-- Sharing on for people who never saw a sharing choice. Anyone who answered an RSVP (the Yes form had
-- the checkbox), saved their profile or pass-page setting, claimed a badge (it opens their profile) or got a
-- pass (its page shows the checkbox) may have chosen, and an untouched box looks the same, so they keep
-- what they have and can tick it on /me/profile.
update participants pa set profile_public = true
 where not pa.profile_public and pa.deleted_at is null
   and not exists (select 1 from audit_log a
                    where a.subject_id = pa.id and a.action in ('rsvp.yes', 'profile.update', 'profile.visibility', 'badge.claim'))
   and not exists (select 1 from passes ps where ps.participant_id = pa.id);

-- As in 20261019214235, without the viewer check; the viewer arguments are optional (signed out).
drop function public.badge_profile(text, uuid, text);
create function public.badge_profile(p_uid text, p_viewer_id uuid default null, p_viewer_email text default null)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  with link as (
    select b.event_id, e.slug, pa.email, pa.first_name, pa.last_name, pa.linkedin_url, pa.profile_public
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
                                     'lastName', l.last_name, 'linkedinUrl', l.linkedin_url)
           else jsonb_build_object('allowed', true, 'public', false)
         end
         || case when l.email = lower(btrim(p_viewer_email)) then jsonb_build_object('self', true, 'slug', l.slug)
                 else '{}'::jsonb end
    from link l
$$;
revoke all on function public.badge_profile(text, uuid, text) from public, anon, authenticated;
grant execute on function public.badge_profile(text, uuid, text) to service_role;
