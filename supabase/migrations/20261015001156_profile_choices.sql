-- Profiles demo feedback (2026-10-14): Year is one of six options, "What I'm good at" is the top 3
-- (1–3 skills, required by the app; profiles created before the first edit may still have none), and
-- the application form gains a "Year of study" dropdown that seeds the profile like the other answers.
-- Approved data change: existing profiles keep their first 3 skills, and free-text years are mapped
-- to an option or cleared.

update profiles set ask_me_about = ask_me_about[1:3], updated_at = now() where cardinality(ask_me_about) > 3;

update profiles set updated_at = now(), year_label = case
    when year_label ~* 'alum|grad'                    then 'Alumni'
    when year_label ~* '^\s*(1|first|freshman)'       then '1st year'
    when year_label ~* '^\s*(2|second|sophomore)'     then '2nd year'
    when year_label ~* '^\s*(3|third|junior)'         then '3rd year'
    when year_label ~* '^\s*(4|fourth|senior)'        then '4th year'
    when year_label ~* '^\s*([5-9]|fifth|sixth)'      then '5+ year'
  end
 where year_label is not null and year_label not in ('1st year', '2nd year', '3rd year', '4th year', '5+ year', 'Alumni');

alter table profiles drop constraint profiles_ask_me_about_check,
  add constraint profiles_ask_me_about_check check (cardinality(ask_me_about) <= 3 and _labels_ok(ask_me_about));
alter table profiles drop constraint profiles_year_label_check,
  add constraint profiles_year_label_check check (year_label in ('1st year', '2nd year', '3rd year', '4th year', '5+ year', 'Alumni'));

alter table participants drop constraint participants_owner_edited_check,
  add constraint participants_owner_edited_check
    check (owner_edited <@ array['dietary', 'accessibility', 'skills', 'lookingFor', 'year']::text[]);

-- The year joins the other form answers. New parameters change the signatures, so the old versions
-- are dropped and re-created; only the year handling is new.
drop function public._ingest_profile_answers(uuid, text[], text[], boolean);
drop function public.ingest_sheet_row(uuid, text, text, text, text, text, participant_status, text, text, boolean, text, text[], text[]);

create or replace function public._ingest_profile_answers(p_participant_id uuid, p_skills text[], p_looking_for text[], p_year text, p_update boolean)
returns void language plpgsql security definer set search_path = public, pg_temp as $$
begin
  if not exists (select 1 from profiles where participant_id = p_participant_id) then
    if cardinality(p_skills) = 0 and cardinality(p_looking_for) = 0 and p_year is null then return; end if;
    insert into profiles (participant_id, linkedin_url, ask_me_about, looking_for, year_label)
    select id, linkedin_url, p_skills, p_looking_for, p_year from participants where id = p_participant_id
    on conflict (participant_id) do nothing;
  end if;
  if p_update then
    update profiles set ask_me_about = p_skills, looking_for = p_looking_for, year_label = p_year, updated_at = now()
     where participant_id = p_participant_id
       and (ask_me_about is distinct from p_skills or looking_for is distinct from p_looking_for or year_label is distinct from p_year);
  end if;
end $$;

create or replace function public.ingest_sheet_row(
  p_event_id      uuid,
  p_external_id   text,
  p_email         text,
  p_first_name    text,
  p_last_name     text,
  p_search_text   text,
  p_status        participant_status,
  p_dietary_notes text    default null,
  p_linkedin_url  text    default null,
  p_dry_run       boolean default false,
  -- Profiles part B (null = the Sheet has no such column: keep what's there).
  p_accessibility_notes text   default null,
  p_skills              text[] default null,
  p_looking_for         text[] default null,
  -- Demo feedback 2026-10-14: the form's Year of study (null = no answer: keep what's there).
  p_year_label          text   default null
) returns text language plpgsql security definer set search_path = public, pg_temp as $$
declare
  pa participants%rowtype;
  pr profiles%rowtype;
  details_changed boolean;
  profile_changed boolean;
  email_taken boolean;
  v_dietary text;
  v_access  text;
  v_skills  text[];
  v_looking text[];
  v_year    text;
begin
  select * into pa from participants where event_id = p_event_id and external_id = p_external_id for update;

  if not found then
    if exists (select 1 from participants where event_id = p_event_id and email = p_email) then
      return 'CONFLICT_DUPLICATE_EMAIL';
    end if;
    if p_dry_run then
      return case when p_status = 'accepted' then 'PASS_QUEUED' else 'CREATED' end;
    end if;
    begin
      insert into participants (event_id, external_id, email, first_name, last_name, search_text,
                                dietary_notes, accessibility_notes, linkedin_url, status, source)
      values (p_event_id, p_external_id, p_email, p_first_name, p_last_name, p_search_text,
              p_dietary_notes, p_accessibility_notes, p_linkedin_url, p_status, 'sheet')
      on conflict (event_id, external_id) do nothing
      returning * into pa;
    exception when unique_violation then
      -- (event_id, email) taken by a concurrent insert under another external_id.
      return 'CONFLICT_DUPLICATE_EMAIL';
    end;
    if found then
      perform _ingest_profile_answers(pa.id, coalesce(p_skills, '{}'), coalesce(p_looking_for, '{}'), p_year_label, false);
      if p_status = 'accepted' then
        insert into email_outbox (participant_id, kind) values (pa.id, 'pass_issued')
        on conflict (participant_id, kind_group) where status in ('pending','sending') do nothing;
        return 'PASS_QUEUED';
      end if;
      return 'CREATED';
    end if;
    -- A concurrent request inserted this external_id first: continue as an existing row.
    select * into pa from participants where event_id = p_event_id and external_id = p_external_id for update;
  end if;

  if pa.deleted_at is not null then
    return 'UNCHANGED';
  end if;

  -- Profiles part B: a field the owner edited in their profile is theirs; the Sheet no longer
  -- overwrites it. An absent column (null) keeps the current value.
  select * into pr from profiles where participant_id = pa.id;
  v_dietary := case when 'dietary' = any(pa.owner_edited) then pa.dietary_notes else p_dietary_notes end;
  v_access  := case when 'accessibility' = any(pa.owner_edited) then pa.accessibility_notes else p_accessibility_notes end;
  v_skills  := case when 'skills' = any(pa.owner_edited) or p_skills is null then coalesce(pr.ask_me_about, '{}') else p_skills end;
  v_looking := case when 'lookingFor' = any(pa.owner_edited) or p_looking_for is null then coalesce(pr.looking_for, '{}') else p_looking_for end;
  v_year    := case when 'year' = any(pa.owner_edited) or p_year_label is null then pr.year_label else p_year_label end;
  profile_changed := v_skills is distinct from coalesce(pr.ask_me_about, '{}') or v_looking is distinct from coalesce(pr.looking_for, '{}')
                  or v_year is distinct from pr.year_label;

  details_changed := pa.first_name    is distinct from p_first_name
                  or pa.last_name     is distinct from p_last_name
                  or pa.dietary_notes is distinct from v_dietary
                  or pa.accessibility_notes is distinct from v_access
                  or pa.linkedin_url  is distinct from p_linkedin_url;
  email_taken := pa.email <> p_email and exists (
    select 1 from participants where event_id = p_event_id and email = p_email and id <> pa.id);

  if pa.status = 'accepted' then
    if p_status = 'pending' then
      return 'IGNORED_CLEAR';  -- DECISION: an accidentally cleared cell must not kill a pass
    end if;

    if p_status = 'accepted' then
      if pa.email <> p_email then
        if email_taken then return 'CONFLICT_DUPLICATE_EMAIL'; end if;
        if not p_dry_run then
          update participants
             set email = p_email, first_name = p_first_name, last_name = p_last_name, search_text = p_search_text,
                 dietary_notes = v_dietary, accessibility_notes = v_access, linkedin_url = p_linkedin_url, updated_at = now()
           where id = pa.id;
          perform _ingest_profile_answers(pa.id, v_skills, v_looking, v_year, true);
          -- Rotation on send revokes the old pass. A pending row already queued will go to the new address.
          insert into email_outbox (participant_id, kind) values (pa.id, 'pass_reissued')
          on conflict (participant_id, kind_group) where status in ('pending','sending') do nothing;
          insert into audit_log (event_id, actor_kind, action, subject_id)
          values (p_event_id, 'sheet_sync', 'participant.email_change', pa.id);
        end if;
        return 'PASS_QUEUED';
      end if;
      if not details_changed and not profile_changed then return 'UNCHANGED'; end if;
      if not p_dry_run then
        perform _ingest_profile_answers(pa.id, v_skills, v_looking, v_year, true);
        update participants
           set first_name = p_first_name, last_name = p_last_name, search_text = p_search_text,
               dietary_notes = v_dietary, accessibility_notes = v_access, linkedin_url = p_linkedin_url, updated_at = now()
         where id = pa.id;
      end if;
      return 'UPDATED';
    end if;

    -- accepted → waitlisted / rejected / withdrawn
    if email_taken then return 'CONFLICT_DUPLICATE_EMAIL'; end if;
    if not p_dry_run then
      update participants
         set status = p_status, email = p_email, first_name = p_first_name, last_name = p_last_name,
             search_text = p_search_text, dietary_notes = v_dietary, accessibility_notes = v_access, linkedin_url = p_linkedin_url,
             updated_at = now()
       where id = pa.id;
      perform _ingest_profile_answers(pa.id, v_skills, v_looking, v_year, true);
      update passes set revoked_at = now(), revoke_reason = 'status_change'
       where participant_id = pa.id and revoked_at is null;
      update email_outbox set status = 'cancelled', locked_until = null
       where participant_id = pa.id and status in ('pending','sending');
    end if;
    return 'REVOKED';
  end if;

  -- Existing participant who is not accepted.
  if email_taken then return 'CONFLICT_DUPLICATE_EMAIL'; end if;
  if p_status <> 'accepted' and pa.status = p_status and pa.email = p_email and not details_changed and not profile_changed then
    return 'UNCHANGED';
  end if;
  if not p_dry_run then
    update participants
       set status = p_status, email = p_email, first_name = p_first_name, last_name = p_last_name,
           search_text = p_search_text, dietary_notes = v_dietary, accessibility_notes = v_access, linkedin_url = p_linkedin_url,
           updated_at = now()
     where id = pa.id;
    perform _ingest_profile_answers(pa.id, v_skills, v_looking, v_year, true);
    if p_status = 'accepted' then
      insert into email_outbox (participant_id, kind) values (pa.id, 'pass_issued')
      on conflict (participant_id, kind_group) where status in ('pending','sending') do nothing;
    end if;
  end if;
  return case when p_status = 'accepted' then 'PASS_QUEUED' else 'UPDATED' end;
end $$;

do $$ declare f text; begin
  foreach f in array array['_ingest_profile_answers(uuid,text[],text[],text,boolean)',
                           'ingest_sheet_row(uuid,text,text,text,text,text,participant_status,text,text,boolean,text,text[],text[],text)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
end $$;
