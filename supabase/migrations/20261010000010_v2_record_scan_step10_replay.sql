-- record_scan step 10 retry race (found by the T-CONC-02 loop, T-CONC-07): v2_scans split step 10
-- into two reads. A concurrent retry of the same clientScanId could commit between them, and the
-- second read then answered ALREADY_SCANNED for our own row. Same function, one added comparison.

create or replace function public.record_scan(
  p_checkpoint_id     uuid,
  p_staff_user_id     uuid,
  p_method            scan_method,
  p_token_hash        text,
  p_participant_id    uuid,
  p_tag_public_id     text,
  p_tag_uid           text,
  p_client_scan_id    uuid,
  p_client_scanned_at timestamptz,
  p_confirm_repeat    boolean default false
) returns jsonb
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cp checkpoints%rowtype; pa participants%rowtype; ps passes%rowtype; tg tags%rowtype;
  prior scans%rowtype; live_n int; new_id uuid; new_no int; who jsonb; holder uuid;
begin
  -- 1. replay
  select * into prior from scans where client_scan_id = p_client_scan_id;
  if found then
    if prior.scanned_by <> p_staff_user_id then
      return jsonb_build_object('code','CLIENT_ID_CONFLICT');
    end if;
    select * into cp from checkpoints  where id = prior.checkpoint_id;
    select * into pa from participants where id = prior.participant_id;
    return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'servingNo',prior.serving_no,
      'voided', prior.voided_at is not null, 'participant', _who(pa, cp.kind));
  end if;

  -- 2-3. checkpoint + authz
  select * into cp from checkpoints where id = p_checkpoint_id;
  if not found then return jsonb_build_object('code','CHECKPOINT_NOT_FOUND'); end if;
  if not exists (select 1 from event_staff where event_id = cp.event_id and user_id = p_staff_user_id) then
    return jsonb_build_object('code','FORBIDDEN');
  end if;

  -- 4. resolve
  if p_method = 'qr' then
    select * into ps from passes where token_hash = p_token_hash;
    if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
    select * into pa from participants where id = ps.participant_id;
  elsif p_method = 'nfc' then                                                      -- [v2]
    tg := _find_tag(p_tag_public_id, p_tag_uid);
    if tg.id is null then return jsonb_build_object('code','NOT_FOUND'); end if;
    if tg.event_id <> cp.event_id then
      return jsonb_build_object('code','WRONG_EVENT','otherEvent',(select name from events where id = tg.event_id));
    end if;
    select participant_id into holder from tag_assignments where tag_id = tg.id and ended_at is null;
    if holder is null then
      select participant_id into holder from tag_assignments where tag_id = tg.id order by assigned_at desc limit 1;
      if holder is not null and tg.retired_at is not null then
        select * into pa from participants where id = holder;
        return jsonb_build_object('code','TAG_REPLACED','participant',_who(pa, cp.kind),'retiredAt',tg.retired_at);
      end if;
      return jsonb_build_object('code','TAG_UNASSIGNED','tagId',tg.id,'tagLabel',tg.label);
    end if;
    select * into pa from participants where id = holder;
    if pa.deleted_at is not null then return jsonb_build_object('code','NOT_FOUND'); end if;
  else
    select * into pa from participants where id = p_participant_id and deleted_at is null;
    if not found then return jsonb_build_object('code','NOT_FOUND'); end if;
  end if;
  who := _who(pa, cp.kind);

  -- 5. revoked (QR passes only)
  if p_method = 'qr' and ps.revoked_at is not null then
    return jsonb_build_object('code','REVOKED','participant',who,'revokeReason',ps.revoke_reason,
      'reissued', exists (select 1 from passes where participant_id = pa.id and revoked_at is null));
  end if;

  -- 6-8. event, status, open
  if pa.event_id <> cp.event_id then
    return jsonb_build_object('code','WRONG_EVENT','otherEvent',(select name from events where id = pa.event_id));
  end if;
  if pa.status <> 'accepted' then return jsonb_build_object('code','NOT_ACCEPTED','participant',who); end if;
  if not cp.is_open then return jsonb_build_object('code','CHECKPOINT_CLOSED','participant',who); end if;

  -- 9. serialize. Capacity: lock the checkpoint (unchanged). [v2] Meals: lock the participant, so two
  -- stations serving the same person get servings n and n+1, and a simultaneous "first" tap sees the other.
  -- Lock order everywhere: checkpoint → participant → tag.
  if cp.capacity is not null then
    perform 1 from checkpoints where id = cp.id for update;
  end if;
  if cp.kind = 'meal' then
    perform 1 from participants where id = pa.id for update;
  end if;

  -- 10. already scanned (a concurrent retry of THIS scan may have committed after step 1)
  select * into prior from scans where client_scan_id = p_client_scan_id;
  if found then
    if prior.scanned_by <> p_staff_user_id then return jsonb_build_object('code','CLIENT_ID_CONFLICT'); end if;
    return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'servingNo',prior.serving_no,'participant',who);
  end if;
  select * into prior from scans
   where participant_id = pa.id and checkpoint_id = cp.id and voided_at is null
   order by serving_no desc limit 1;
  if found then
    -- A retry of THIS scan can commit between the client_scan_id read above and this read (each
    -- statement takes a fresh snapshot), so compare before answering ALREADY_SCANNED/REPEAT_SERVING.
    if prior.client_scan_id = p_client_scan_id then
      if prior.scanned_by <> p_staff_user_id then return jsonb_build_object('code','CLIENT_ID_CONFLICT'); end if;
      return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'servingNo',prior.serving_no,'participant',who);
    end if;
    if cp.kind <> 'meal' then
      return jsonb_build_object('code','ALREADY_SCANNED','participant',who,'previous',_prior(prior, p_staff_user_id));
    end if;
    if not (p_confirm_repeat or cp.seconds_open) then                              -- [v2] soft warning
      select count(*) into live_n from scans where participant_id = pa.id and checkpoint_id = cp.id and voided_at is null;
      return jsonb_build_object('code','REPEAT_SERVING','participant',who,'servedCount',live_n,
                                'previous',_prior(prior, p_staff_user_id));
    end if;
  end if;

  -- 11. door prerequisite
  if cp.requires_checkin and not exists (
      select 1 from scans s join checkpoints d on d.id = s.checkpoint_id
       where s.participant_id = pa.id and d.kind = 'door' and s.voided_at is null) then
    return jsonb_build_object('code','NOT_CHECKED_IN','participant',who);
  end if;

  -- 12. capacity
  if cp.capacity is not null then
    select count(*) into live_n from scans where checkpoint_id = cp.id and voided_at is null;
    if live_n >= cp.capacity then
      return jsonb_build_object('code','CAPACITY_REACHED','participant',who,'capacity',cp.capacity);
    end if;
  end if;

  -- 13. insert. Meals number servings over ALL rows (voided too), so a number is never reused.
  new_no := case when cp.kind = 'meal'
                 then (select coalesce(max(serving_no), 0) + 1 from scans where participant_id = pa.id and checkpoint_id = cp.id)
                 else 1 end;
  begin
    insert into scans (event_id, participant_id, checkpoint_id, pass_id, tag_id, method, serving_no,
                       scanned_by, client_scan_id, client_scanned_at)
    values (cp.event_id, pa.id, cp.id, case when p_method = 'qr' then ps.id end,
            case when p_method = 'nfc' then tg.id end, p_method, new_no,
            p_staff_user_id, p_client_scan_id, p_client_scanned_at)
    on conflict (participant_id, checkpoint_id, serving_no) where voided_at is null do nothing
    returning id into new_id;
  exception when unique_violation then
    select * into prior from scans where client_scan_id = p_client_scan_id;
    if found and prior.scanned_by = p_staff_user_id then
      return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'servingNo',prior.serving_no,'participant',who);
    end if;
    return jsonb_build_object('code','CLIENT_ID_CONFLICT');
  end;

  if new_id is null then
    select * into prior from scans where participant_id = pa.id and checkpoint_id = cp.id and voided_at is null
     order by serving_no desc limit 1;
    if prior.client_scan_id = p_client_scan_id then
      return jsonb_build_object('code','ACCEPTED','replayed',true,'scanId',prior.id,'servingNo',prior.serving_no,'participant',who);
    end if;
    return jsonb_build_object('code','ALREADY_SCANNED','participant',who,'previous',_prior(prior, p_staff_user_id));
  end if;

  return jsonb_build_object('code','ACCEPTED','replayed',false,'scanId',new_id,'servingNo',new_no,
                            'points',cp.points,'participant',who);
end $$;

revoke all on function public._who(participants, checkpoint_kind) from public, anon, authenticated;
revoke all on function public.record_scan(uuid,uuid,scan_method,text,uuid,text,text,uuid,timestamptz,boolean) from public, anon, authenticated;
grant execute on function public.record_scan(uuid,uuid,scan_method,text,uuid,text,text,uuid,timestamptz,boolean) to service_role;
