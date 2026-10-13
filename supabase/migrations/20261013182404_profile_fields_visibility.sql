-- Profiles (user decisions 2026-10-13): new fields and per-field visibility. Additive only.
--   * participants.accessibility_notes: health/accessibility needs, next to dietary_notes (same staff
--     use, same 30-day retention, same tombstone).
--   * profiles.looking_for: what the person is looking for at the event.
--   * profiles.public_fields: which fields OTHER PARTICIPANTS may see. Organizers/staff see everything.
--     dietary and accessibility are never public unless the owner opts in (I-19, revised).
--   * "What I'm good at" (skills) reuses profiles.ask_me_about, now for every badge role.

alter table participants
  add column accessibility_notes text check (length(accessibility_notes) <= 500);

alter table profiles
  add column looking_for text[] not null default '{}'
    check (looking_for <@ array['team', 'mentor', 'internship', 'job', 'networking']::text[]),
  add column public_fields text[] not null
    default array['pronouns', 'program', 'year', 'bio', 'links', 'skills', 'lookingFor', 'discord']::text[]
    check (public_fields <@ array['pronouns', 'program', 'year', 'bio', 'links', 'skills', 'lookingFor', 'discord', 'dietary', 'accessibility']::text[]);

-- The §5.1 tombstone also clears accessibility_notes. Otherwise identical to the V4a version.
create or replace function public.delete_participant(p_event_id uuid, p_participant_id uuid, p_actor uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype;
begin
  select * into pa from participants where id = p_participant_id and event_id = p_event_id for update;
  if not found then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  if pa.deleted_at is not null then return jsonb_build_object('code', 'ALREADY_DELETED'); end if;
  update participants
     set deleted_at = now(), first_name = 'Deleted', last_name = '', email = 'deleted+' || id || '@invalid',
         search_text = '', dietary_notes = null, accessibility_notes = null, linkedin_url = null, photo_path = null, photo_updated_at = null,
         updated_at = now()
   where id = pa.id;
  update passes set revoked_at = now(), revoke_reason = 'deleted' where participant_id = pa.id and revoked_at is null;
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = pa.id and status in ('pending', 'sending');
  delete from profiles where participant_id = pa.id;
  update profile_keys set revoked_at = now(), revoke_reason = 'deleted' where participant_id = pa.id and revoked_at is null;
  update participant_sessions set revoked_at = now() where participant_id = pa.id and revoked_at is null;
  delete from signin_codes where participant_id = pa.id;
  update tag_assignments set ended_at = now(), ended_by = p_actor, end_reason = 'participant_removed'
   where participant_id = pa.id and ended_at is null;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'participant.delete', pa.id);
  return jsonb_build_object('code', 'DELETED', 'photoPath', pa.photo_path);
end $$;
