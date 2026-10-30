-- SPEC §6.5 (v0.11.3, user decision 2026-10-29): tapping a badge always shows its holder's name; the sharing
-- switch (profile_public) now covers only the links (LinkedIn, Discord, website). As in 20261027172536 otherwise:
-- never email, dietary notes, allergies, status or photo.
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
  select jsonb_build_object('allowed', true, 'public', l.profile_public, 'firstName', l.first_name, 'lastName', l.last_name)
         || case when l.profile_public
                 then jsonb_build_object('linkedinUrl', l.linkedin_url, 'discord', l.discord_username, 'websiteUrl', l.website_url)
                 else '{}'::jsonb end
         || case when l.email = lower(btrim(p_viewer_email)) then jsonb_build_object('self', true, 'slug', l.slug)
                 else '{}'::jsonb end
    from link l
$$;
revoke all on function public.badge_profile(text, uuid, text) from public, anon, authenticated;
grant execute on function public.badge_profile(text, uuid, text) to service_role;
