-- PLAN §6.3. Everyone who wears a badge is a `participants` row: applicants, walk-ins and staff
-- (organizers, and mentors/judges/volunteers if the team says so, (?) Q2). The public profile is a
-- separate 1:1 table so nothing staff-only (email, photo, dietary notes) can leak into it by accident.

alter table participants
  add column badge_role    text not null default 'participant'
    check (badge_role in ('participant', 'organizer', 'mentor', 'judge', 'volunteer')),
  add column staff_user_id uuid references auth.users on delete set null;
alter table participants drop constraint participants_source_check,
  add constraint participants_source_check check (source in ('sheet', 'walk_in', 'seed', 'staff'));
create unique index participants_one_per_staff_user on participants (event_id, staff_user_id)
  where staff_user_id is not null;

create or replace function public._labels_ok(a text[])
returns boolean language sql immutable set search_path = public, pg_temp as $$
  select coalesce(bool_and(length(btrim(x)) between 1 and 30 and x = btrim(x)), true) from unnest(a) x
$$;

create table profiles (
  participant_id   uuid primary key references participants on delete cascade,
  nickname         text check (length(nickname) between 1 and 40),
  pronouns         text check (length(pronouns) <= 30),
  program          text check (length(program) <= 80),
  year_label       text check (length(year_label) <= 30),
  bio              text check (length(bio) <= 280),
  linkedin_url     text check (linkedin_url ~ '^https://(www\.)?linkedin\.com/in/[A-Za-z0-9_%-]+/?$'),
  github_url       text check (github_url ~ '^https://(www\.)?github\.com/[A-Za-z0-9-]{1,39}/?$'),
  website_url      text check (website_url ~ '^https://[^[:space:]<>"]{4,200}$'),
  discord_handle   text check (discord_handle ~ '^[a-z0-9_.]{2,32}$'),          -- (?) Q2 mentor directory
  ask_me_about     text[] not null default '{}' check (cardinality(ask_me_about) <= 5 and _labels_ok(ask_me_about)),
  visibility       text not null default 'public' check (visibility in ('public', 'hidden')),
  hidden_by_staff_at timestamptz,                                              -- abuse switch; wins over visibility
  updated_at       timestamptz not null default now()
);

-- Edit-link keys (PLAN §7.3). Only sha256 hashes are stored (I-3). Several may be active at once:
-- every pass email carries a fresh key, and older emailed links must keep working. Only the owner's
-- "Get a new link" (rotation), a status change, deletion or retention revokes them, all at once.
create table profile_keys (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants on delete cascade,
  key_hash       text not null unique check (key_hash ~ '^[0-9a-f]{64}$'),
  issued_at      timestamptz not null default now(),
  revoked_at     timestamptz,
  revoke_reason  text check (revoke_reason in ('rotated', 'status_change', 'deleted', 'retention')),
  check ((revoked_at is null) = (revoke_reason is null))
);
create index profile_keys_participant on profile_keys (participant_id) where revoked_at is null;

-- The browser's sign-in: an httpOnly cookie holding a random value; we store its hash.
create table participant_sessions (
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid not null references participants on delete cascade,
  session_hash   text not null unique check (session_hash ~ '^[0-9a-f]{64}$'),
  via            text not null check (via in ('edit_link', 'signin_code')),
  created_at     timestamptz not null default now(),
  last_seen_at   timestamptz not null default now(),
  expires_at     timestamptz not null,
  revoked_at     timestamptz
);
create index participant_sessions_participant on participant_sessions (participant_id) where revoked_at is null;

-- 2-minute, single-use codes shown as a QR: a staff member signing someone in face to face, and an
-- organizer hopping from the admin host to their own badge profile on the participant host.
create table signin_codes (
  code_hash      text primary key check (code_hash ~ '^[0-9a-f]{64}$'),
  participant_id uuid not null references participants on delete cascade,
  purpose        text not null check (purpose in ('staff_handoff', 'organizer_hop')),
  created_by     uuid not null references auth.users,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null,
  used_at        timestamptz
);

-- A participant can hold a session only while accepted and not deleted. Checked on every read, so a
-- withdrawal or deletion signs them out everywhere without touching the sessions table.
create or replace function public._eligible(pa participants)
returns boolean language sql stable set search_path = public, pg_temp as $$
  select pa.status = 'accepted' and pa.deleted_at is null
$$;

create or replace function public.issue_profile_key(p_participant_id uuid, p_key_hash text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid;
begin
  insert into profile_keys (participant_id, key_hash) values (p_participant_id, p_key_hash) returning id into new_id;
  insert into profiles (participant_id, linkedin_url)
  select id, linkedin_url from participants where id = p_participant_id
  on conflict (participant_id) do nothing;            -- first key: start the profile with the form's LinkedIn
  return new_id;
end $$;

-- Owner's "Get a new link": every old link AND every signed-in device stops working.
create or replace function public.rotate_profile_keys(p_participant_id uuid, p_new_key_hash text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid;
begin
  perform 1 from participants where id = p_participant_id for update;
  update profile_keys set revoked_at = now(), revoke_reason = 'rotated'
   where participant_id = p_participant_id and revoked_at is null;
  update participant_sessions set revoked_at = now()
   where participant_id = p_participant_id and revoked_at is null;
  insert into profile_keys (participant_id, key_hash) values (p_participant_id, p_new_key_hash) returning id into new_id;
  return new_id;
end $$;

create or replace function public.open_profile_session(p_key_hash text, p_session_hash text, p_ttl interval)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare k profile_keys%rowtype; pa participants%rowtype;
begin
  select * into k from profile_keys where key_hash = p_key_hash;
  if not found then return jsonb_build_object('code', 'KEY_NOT_FOUND'); end if;
  if k.revoked_at is not null then return jsonb_build_object('code', 'KEY_REVOKED'); end if;
  select * into pa from participants where id = k.participant_id;
  if not _eligible(pa) then return jsonb_build_object('code', 'NOT_ELIGIBLE'); end if;
  insert into participant_sessions (participant_id, session_hash, via, expires_at)
  values (pa.id, p_session_hash, 'edit_link', now() + p_ttl);
  return jsonb_build_object('code', 'OPENED', 'participantId', pa.id);
end $$;

create or replace function public.issue_signin_code(
  p_participant_id uuid, p_code_hash text, p_purpose text, p_created_by uuid
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare pa participants%rowtype;
begin
  select * into pa from participants where id = p_participant_id;
  if not found or not _eligible(pa) then return 'NOT_ELIGIBLE'; end if;
  if p_purpose = 'staff_handoff'
     and not exists (select 1 from event_staff where event_id = pa.event_id and user_id = p_created_by) then
    return 'FORBIDDEN';
  end if;
  if p_purpose = 'organizer_hop' and pa.staff_user_id is distinct from p_created_by then
    return 'FORBIDDEN';
  end if;
  insert into signin_codes (code_hash, participant_id, purpose, created_by, expires_at)
  values (p_code_hash, pa.id, p_purpose, p_created_by, now() + interval '2 minutes');
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (pa.event_id, p_created_by, 'staff', 'signin_code.issue', pa.id, jsonb_build_object('purpose', p_purpose));
  return 'ISSUED';
end $$;

-- Single use is enforced by the conditional UPDATE: of two simultaneous redemptions, one wins.
create or replace function public.redeem_signin_code(p_code_hash text, p_session_hash text, p_ttl interval)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare c signin_codes%rowtype; pa participants%rowtype;
begin
  update signin_codes set used_at = now()
   where code_hash = p_code_hash and used_at is null and expires_at > now()
  returning * into c;
  if not found then return jsonb_build_object('code', 'CODE_INVALID'); end if;
  select * into pa from participants where id = c.participant_id;
  if not _eligible(pa) then return jsonb_build_object('code', 'NOT_ELIGIBLE'); end if;
  insert into participant_sessions (participant_id, session_hash, via, expires_at)
  values (pa.id, p_session_hash, 'signin_code', now() + p_ttl);
  return jsonb_build_object('code', 'OPENED', 'participantId', pa.id);
end $$;

-- Resolve the cookie on every participant request. Touches last_seen_at at most every 5 minutes.
create or replace function public.session_participant(p_session_hash text)
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare s participant_sessions%rowtype; pa participants%rowtype;
begin
  select * into s from participant_sessions
   where session_hash = p_session_hash and revoked_at is null and expires_at > now();
  if not found then return null; end if;
  select * into pa from participants where id = s.participant_id;
  if not _eligible(pa) then return null; end if;
  if s.last_seen_at < now() - interval '5 minutes' then
    update participant_sessions set last_seen_at = now() where id = s.id;
  end if;
  return pa.id;
end $$;

create or replace function public.end_profile_session(p_session_hash text)
returns void language sql security definer set search_path = public, pg_temp as $$
  update participant_sessions set revoked_at = now() where session_hash = p_session_hash and revoked_at is null
$$;

-- Organizer badges (PLAN §7.6): the staff member's own attendee row for an event. Idempotent. If the
-- organizer also applied through the form with the same email, that row becomes their badge row.
create or replace function public.ensure_staff_attendee(p_event_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare r staff_role; em text; dn text; pid uuid;
begin
  select role into r from event_staff where event_id = p_event_id and user_id = p_user_id;
  if not found then return jsonb_build_object('code', 'FORBIDDEN'); end if;
  select lower(btrim(email)) into em from auth.users where id = p_user_id;
  select display_name into dn from staff_profiles where user_id = p_user_id;
  if em is null or dn is null then return jsonb_build_object('code', 'PROFILE_INCOMPLETE'); end if;
  select id into pid from participants where event_id = p_event_id and staff_user_id = p_user_id;
  if pid is null then
    insert into participants (event_id, email, first_name, last_name, search_text, status, source,
                              badge_role, staff_user_id)
    values (p_event_id, em, dn, '', lower(dn), 'accepted', 'staff',
            case when r = 'organizer' then 'organizer' else 'volunteer' end, p_user_id)
    on conflict (event_id, email) do update
       set staff_user_id = excluded.staff_user_id, badge_role = excluded.badge_role,
           status = 'accepted', updated_at = now()
    returning id into pid;
  end if;
  insert into profiles (participant_id, nickname) values (pid, left(dn, 40)) on conflict (participant_id) do nothing;
  return jsonb_build_object('code', 'OK', 'participantId', pid);
end $$;

do $$ declare f text; begin
  foreach f in array array[
    '_labels_ok(text[])', '_eligible(participants)', 'issue_profile_key(uuid,text)',
    'rotate_profile_keys(uuid,text)', 'open_profile_session(text,text,interval)',
    'issue_signin_code(uuid,text,text,uuid)', 'redeem_signin_code(text,text,interval)',
    'session_participant(text)', 'end_profile_session(text)', 'ensure_staff_attendee(uuid,uuid)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
alter table profiles             enable row level security;
alter table profile_keys         enable row level security;
alter table participant_sessions enable row level security;
alter table signin_codes         enable row level security;

-- Added in V2a (not in the reference SQL): the SPEC §5.1 tombstone must also clear the v2 PII.
-- profiles holds a LinkedIn URL, nickname and bio; keys, sessions and sign-in codes stop working.
-- Everything else is unchanged from 20260924072215_admin.sql.
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
         updated_at = now()
   where id = pa.id;
  update passes set revoked_at = now(), revoke_reason = 'deleted' where participant_id = pa.id and revoked_at is null;
  update email_outbox set status = 'cancelled', locked_until = null
   where participant_id = pa.id and status in ('pending', 'sending');
  delete from profiles where participant_id = pa.id;
  update profile_keys set revoked_at = now(), revoke_reason = 'deleted' where participant_id = pa.id and revoked_at is null;
  update participant_sessions set revoked_at = now() where participant_id = pa.id and revoked_at is null;
  delete from signin_codes where participant_id = pa.id;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'participant.delete', pa.id);
  return jsonb_build_object('code', 'DELETED', 'photoPath', pa.photo_path);
end $$;
revoke all on function public.delete_participant(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_participant(uuid, uuid, uuid) to service_role;
