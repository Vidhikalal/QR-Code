-- V4a. Reference 04 (tags) unchanged, then staff_stations from reference 05 (PLAN §6 allows moving it
-- here), then three additions.

-- PLAN §6.4. NFC badges. A tag belongs to exactly one event (badges are single-event, decided).
-- The URL written on the tag is https://<ME_HOST>/t/<public_id>; public_id is an identifier, never a
-- credential: anyone can read it off the tag (PLAN §4 principle P2).

create table tags (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references events on delete cascade,
  public_id     text not null unique check (public_id ~ '^[A-Za-z0-9_-]{12}$'),   -- 9 random bytes, base64url
  uid           text unique check (uid ~ '^[0-9A-F]{8,20}$'),                     -- chip serial, normalized
  label         text check (length(label) between 1 and 20),                      -- optional printed code, e.g. B-0412
  registered_by uuid references auth.users,
  registered_at timestamptz not null default now(),
  retired_at    timestamptz,
  retire_reason text check (retire_reason in ('replaced', 'damaged')),
  unique (id, event_id),
  check ((retired_at is null) = (retire_reason is null))
);

create table tag_assignments (
  id             uuid primary key default gen_random_uuid(),
  event_id       uuid not null,
  tag_id         uuid not null,
  participant_id uuid not null,
  assigned_by    uuid not null references auth.users,
  assigned_at    timestamptz not null default now(),
  ended_at       timestamptz,
  ended_by       uuid references auth.users,
  end_reason     text check (end_reason in ('replaced', 'unassigned', 'participant_removed')),
  -- A badge from event A can never be linked to a person in event B:
  foreign key (tag_id, event_id)         references tags (id, event_id),
  foreign key (participant_id, event_id) references participants (id, event_id),
  check ((ended_at is null) = (end_reason is null)),
  check ((ended_at is null) = (ended_by is null))
);
create unique index tag_assignments_one_per_tag         on tag_assignments (tag_id)         where ended_at is null;
create unique index tag_assignments_one_per_participant on tag_assignments (participant_id) where ended_at is null;
create index        tag_assignments_tag_history         on tag_assignments (tag_id, assigned_at desc);

-- Find a tag by whichever identifier the reader produced. Phones give the URL (public_id); a
-- keyboard-wedge USB reader gives only the chip serial (uid). Exactly one should be non-null.
create or replace function public._find_tag(p_public_id text, p_uid text)
returns tags language sql stable set search_path = public, pg_temp as $$
  select * from tags
   where (p_public_id is not null and public_id = p_public_id)
      or (p_public_id is null and p_uid is not null and uid = p_uid)
   limit 1
$$;

-- Register page (PLAN §8.5): the server mints public_id; the phone writes the URL, reads back the
-- chip serial and confirms. Vendor CSV import calls this once per row with both values.
create or replace function public.register_tag(
  p_event_id uuid, p_staff_id uuid, p_public_id text, p_uid text, p_label text default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare t tags%rowtype;
begin
  if not exists (select 1 from event_staff where event_id = p_event_id and user_id = p_staff_id and role = 'organizer') then
    return 'FORBIDDEN';
  end if;
  select * into t from tags where public_id = p_public_id;
  if found then
    if t.event_id <> p_event_id then return 'PUBLIC_ID_CONFLICT'; end if;
    if t.uid = p_uid or p_uid is null then return 'ALREADY_REGISTERED'; end if;
    if t.uid is not null then return 'PUBLIC_ID_CONFLICT'; end if;
    begin
      update tags set uid = p_uid where id = t.id;               -- reserved row, now confirmed
    exception when unique_violation then
      return 'UID_CONFLICT';                                      -- this chip already carries another id
    end;
    return 'REGISTERED';
  end if;
  begin
    insert into tags (event_id, public_id, uid, label, registered_by)
    values (p_event_id, p_public_id, p_uid, p_label, p_staff_id);
  exception when unique_violation then
    return case when exists (select 1 from tags where uid = p_uid) then 'UID_CONFLICT' else 'PUBLIC_ID_CONFLICT' end;
  end;
  return 'REGISTERED';
end $$;

create or replace function public._tag_holder(p_participant_id uuid)
returns jsonb language sql stable set search_path = public, pg_temp as $$
  select jsonb_build_object('id', pa.id, 'displayName', btrim(pa.first_name || ' ' || pa.last_name),
                            'photoPath', pa.photo_path, 'badgeRole', pa.badge_role)
    from participants pa where pa.id = p_participant_id
$$;

-- Door step 2 (PLAN §7.4). Lock order is always participant → tag (no deadlock with other paths).
-- p_replace: the participant already wears a badge and it is lost/broken: end it and retire it.
create or replace function public.assign_tag(
  p_event_id uuid, p_staff_id uuid, p_participant_id uuid,
  p_public_id text, p_uid text, p_replace boolean default false
) returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare
  t tags%rowtype; pa participants%rowtype; cur tag_assignments%rowtype; theirs tag_assignments%rowtype;
  new_id uuid;
begin
  if not exists (select 1 from event_staff where event_id = p_event_id and user_id = p_staff_id) then
    return jsonb_build_object('code', 'FORBIDDEN');
  end if;
  t := _find_tag(p_public_id, p_uid);
  if t.id is null then return jsonb_build_object('code', 'TAG_NOT_FOUND'); end if;
  if t.event_id <> p_event_id then return jsonb_build_object('code', 'TAG_WRONG_EVENT'); end if;

  select * into pa from participants where id = p_participant_id and event_id = p_event_id and deleted_at is null
    for update;
  if not found then return jsonb_build_object('code', 'NOT_FOUND'); end if;
  if pa.status <> 'accepted' then return jsonb_build_object('code', 'NOT_ACCEPTED', 'status', pa.status); end if;

  select * into t from tags where id = t.id for update;              -- re-read under lock
  if t.retired_at is not null then return jsonb_build_object('code', 'TAG_RETIRED'); end if;

  select * into cur from tag_assignments where tag_id = t.id and ended_at is null;
  if found then
    if cur.participant_id = pa.id then
      return jsonb_build_object('code', 'ALREADY_ASSIGNED', 'assignmentId', cur.id);
    end if;
    return jsonb_build_object('code', 'TAG_IN_USE', 'holder', _tag_holder(cur.participant_id));
  end if;

  select * into theirs from tag_assignments where participant_id = pa.id and ended_at is null;
  if found then
    if not p_replace then
      return jsonb_build_object('code', 'PARTICIPANT_HAS_TAG',
        'currentTag', (select jsonb_build_object('publicId', public_id, 'label', label) from tags where id = theirs.tag_id));
    end if;
    update tag_assignments set ended_at = now(), ended_by = p_staff_id, end_reason = 'replaced' where id = theirs.id;
    update tags set retired_at = now(), retire_reason = 'replaced' where id = theirs.tag_id;
  end if;

  insert into tag_assignments (event_id, tag_id, participant_id, assigned_by)
  values (p_event_id, t.id, pa.id, p_staff_id) returning id into new_id;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (p_event_id, p_staff_id, 'staff', case when theirs.id is null then 'tag.assign' else 'tag.replace' end, pa.id,
          jsonb_build_object('tag_id', t.id));
  return jsonb_build_object('code', 'ASSIGNED', 'assignmentId', new_id, 'replaced', theirs.id is not null,
                            'participant', _tag_holder(pa.id));
end $$;

-- Undo a mistaken link (wrong badge picked up). The tag stays usable. Volunteers: own, ≤ 120 s.
create or replace function public.unassign_tag(p_assignment_id uuid, p_staff_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare a tag_assignments%rowtype; r staff_role;
begin
  select * into a from tag_assignments where id = p_assignment_id for update;
  if not found then return 'NOT_FOUND'; end if;
  select role into r from event_staff where event_id = a.event_id and user_id = p_staff_id;
  if not found then return 'FORBIDDEN'; end if;
  if a.ended_at is not null then return 'ALREADY_ENDED'; end if;
  if r <> 'organizer' and (a.assigned_by <> p_staff_id or now() - a.assigned_at > interval '120 seconds') then
    return 'FORBIDDEN';
  end if;
  update tag_assignments set ended_at = now(), ended_by = p_staff_id, end_reason = 'unassigned' where id = a.id;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id, detail)
  values (a.event_id, p_staff_id, 'staff', 'tag.unassign', a.participant_id, jsonb_build_object('tag_id', a.tag_id));
  return 'UNASSIGNED';
end $$;

-- Everything the badge page needs about a tag, viewer-independent. Shaping per viewer happens in
-- lib/badge/view.ts (pure) so the "who sees what" matrix is unit-tested (T-BADGE-*).
create or replace function public.tag_view(p_public_id text)
returns jsonb language sql stable security definer set search_path = public, pg_temp as $$
  select jsonb_build_object(
    'tag', jsonb_build_object('id', t.id, 'eventId', t.event_id, 'label', t.label,
                              'retiredAt', t.retired_at, 'retireReason', t.retire_reason),
    'event', jsonb_build_object('slug', e.slug, 'name', e.name, 'endsAt', e.ends_at,
                                'retentionDays', e.profile_retention_days),
    'assignment', (select jsonb_build_object('id', a.id, 'participantId', a.participant_id, 'assignedAt', a.assigned_at,
                                             'assignedBy', a.assigned_by)
                     from tag_assignments a where a.tag_id = t.id and a.ended_at is null),
    'lastHolderId', (select a.participant_id from tag_assignments a
                      where a.tag_id = t.id order by a.assigned_at desc limit 1))
    from tags t join events e on e.id = t.event_id
   where t.public_id = p_public_id
$$;

do $$ declare f text; begin
  foreach f in array array[
    '_find_tag(text,text)', 'register_tag(uuid,uuid,text,text,text)', '_tag_holder(uuid)',
    'assign_tag(uuid,uuid,uuid,text,text,boolean)', 'unassign_tag(uuid,uuid)', 'tag_view(text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
alter table tags            enable row level security;
alter table tag_assignments enable row level security;


-- The checkpoint a staff member is working (PLAN §7.7). Stored server-side, not in localStorage,
-- because the scanner (admin host) and the badge page an iPhone opens (participant host) are
-- different origins and cannot share browser storage.
create table staff_stations (
  user_id       uuid not null references auth.users on delete cascade,
  event_id      uuid not null,
  checkpoint_id uuid not null,
  updated_at    timestamptz not null default now(),
  primary key (user_id, event_id),
  foreign key (checkpoint_id, event_id) references checkpoints (id, event_id) on delete cascade
);
alter table staff_stations enable row level security;

create or replace function public.set_staff_station(p_user_id uuid, p_checkpoint_id uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare ev uuid;
begin
  select event_id into ev from checkpoints where id = p_checkpoint_id;
  if ev is null then return 'CHECKPOINT_NOT_FOUND'; end if;
  if not exists (select 1 from event_staff where event_id = ev and user_id = p_user_id) then return 'FORBIDDEN'; end if;
  insert into staff_stations (user_id, event_id, checkpoint_id) values (p_user_id, ev, p_checkpoint_id)
  on conflict (user_id, event_id) do update set checkpoint_id = excluded.checkpoint_id, updated_at = now();
  return 'SET';
end $$;
revoke all on function public.set_staff_station(uuid, uuid) from public, anon, authenticated;
grant execute on function public.set_staff_station(uuid, uuid) to service_role;

-- Added in V4a (not in the reference SQL) -----------------------------------------------------------

-- Labels are sequential per event (PLAN §6.5, "assigned at reserve time"). Computing the next number in
-- TypeScript would race; the event row lock serializes reservations, and the constraint backs it up.
alter table tags add constraint tags_label_unique_per_event unique (event_id, label);

create or replace function public.reserve_tag(p_event_id uuid, p_staff_id uuid, p_public_id text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare n int; lbl text;
begin
  if not exists (select 1 from event_staff where event_id = p_event_id and user_id = p_staff_id and role = 'organizer') then
    return jsonb_build_object('code', 'FORBIDDEN');
  end if;
  perform 1 from events where id = p_event_id for update;
  select coalesce(max(substring(label from '^B-(\d+)$')::int), 0) + 1 into n from tags where event_id = p_event_id;
  lbl := 'B-' || lpad(n::text, 4, '0');
  begin
    insert into tags (event_id, public_id, label, registered_by) values (p_event_id, p_public_id, lbl, p_staff_id);
  exception when unique_violation then
    return jsonb_build_object('code', 'PUBLIC_ID_CONFLICT');
  end;
  return jsonb_build_object('code', 'RESERVED', 'label', lbl);
end $$;
revoke all on function public.reserve_tag(uuid, uuid, text) from public, anon, authenticated;
grant execute on function public.reserve_tag(uuid, uuid, text) to service_role;

-- The §5.1 tombstone also ends the person's active badge link ('participant_removed' exists in the
-- reference schema but nothing used it). Otherwise identical to the V2a version.
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
  update tag_assignments set ended_at = now(), ended_by = p_actor, end_reason = 'participant_removed'
   where participant_id = pa.id and ended_at is null;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'participant.delete', pa.id);
  return jsonb_build_object('code', 'DELETED', 'photoPath', pa.photo_path);
end $$;
revoke all on function public.delete_participant(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.delete_participant(uuid, uuid, uuid) to service_role;
