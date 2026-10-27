-- SPEC v0.10 (§6.5): staff link badges; organizers may unlink them.
drop function public.claim_badge(text, uuid, text, uuid);

create function public.unlink_badge(p_event_id uuid, p_participant_id uuid, p_actor uuid)
returns text language plpgsql security definer set search_path = public, pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtext('passline:badge_link'), hashtext(p_event_id::text));
  perform 1 from participants where id = p_participant_id and event_id = p_event_id and deleted_at is null for update;
  if not found then return 'NOT_FOUND'; end if;
  delete from badges where event_id = p_event_id and participant_id = p_participant_id;
  if not found then return 'NOT_FOUND'; end if;
  insert into audit_log (event_id, actor_user_id, actor_kind, action, subject_id)
  values (p_event_id, p_actor, 'staff', 'badge.unlink', p_participant_id);
  return 'UNLINKED';
end $$;
revoke all on function public.unlink_badge(uuid, uuid, uuid) from public, anon, authenticated;
grant execute on function public.unlink_badge(uuid, uuid, uuid) to service_role;

-- §11 participants table: as in 20261026171328, plus whether a badge is linked (one row each, so no second
-- query that the API's row cap could cut short).
drop function public.admin_participants(uuid, participant_status, text, boolean);
create function public.admin_participants(
  p_event_id uuid, p_status participant_status default null, p_query text default null, p_no_show boolean default false
) returns table (
  id uuid, first_name text, last_name text, email text, status participant_status, source text, is_test boolean,
  external_id text, dietary_notes text, photo_path text, photo_updated_at timestamptz, pass_state text,
  live_scans int, checked_in boolean, created_at timestamptz, rsvp_sent_at timestamptz,
  overnight text, team_status text, allergies text, allergy_severity text, has_badge boolean
) language sql stable security definer set search_path = public, pg_temp as $$
  select p.id, p.first_name, p.last_name, p.email, p.status, p.source, p.is_test, p.external_id, p.dietary_notes,
         p.photo_path, p.photo_updated_at,
         case when exists (select 1 from passes ps where ps.participant_id = p.id and ps.revoked_at is null) then 'active'
              when exists (select 1 from passes ps where ps.participant_id = p.id) then 'revoked'
              else 'none' end as pass_state,
         (select count(*)::int from scans s where s.participant_id = p.id and s.voided_at is null) as live_scans,
         exists (select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
                  where s.participant_id = p.id and c.kind = 'door' and s.voided_at is null) as checked_in,
         p.created_at,
         p.rsvp_sent_at,
         p.overnight, p.team_status, p.allergies, p.allergy_severity,
         exists (select 1 from badges b where b.participant_id = p.id) as has_badge
    from participants p
   where p.event_id = p_event_id
     and p.deleted_at is null
     and (p_status is null or p.status = p_status)
     and (p_query is null or p.search_text like '%' || p_query || '%' or p.email like '%' || p_query || '%')
     and (not p_no_show or (p.status = 'accepted' and not p.is_test and not exists (
            select 1 from scans s join checkpoints c on c.id = s.checkpoint_id
             where s.participant_id = p.id and c.kind = 'door' and s.voided_at is null)))
   order by p.last_name, p.first_name, p.id
   limit 1000
$$;
revoke all on function public.admin_participants(uuid, participant_status, text, boolean) from public, anon, authenticated;
grant execute on function public.admin_participants(uuid, participant_status, text, boolean) to service_role;
