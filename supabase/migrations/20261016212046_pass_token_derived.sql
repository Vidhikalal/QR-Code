-- SPEC §6.1 (v0.4): the caller may choose the pass id, because the token is derived from it
-- (HMAC with PASS_TOKEN_SECRET), so the owner can see their pass again on /me. Only the hash is stored.
-- Same body as §6.3 otherwise; callers that pass no id get a random one, as before.
drop function public.issue_pass(uuid, text);
create function public.issue_pass(p_participant_id uuid, p_token_hash text, p_pass_id uuid default gen_random_uuid())
returns uuid language plpgsql security definer set search_path = public, pg_temp as $$
declare new_id uuid;
begin
  perform 1 from participants where id = p_participant_id for update;  -- serialize issuance
  update passes set revoked_at = now(), revoke_reason = 'rotated'
   where participant_id = p_participant_id and revoked_at is null;
  insert into passes (id, participant_id, token_hash) values (p_pass_id, p_participant_id, p_token_hash)
  returning id into new_id;
  return new_id;
end $$;
revoke all on function public.issue_pass(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.issue_pass(uuid, text, uuid) to service_role;
