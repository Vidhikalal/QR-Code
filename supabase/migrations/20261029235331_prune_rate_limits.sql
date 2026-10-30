-- SPEC §15: rate_limit_hit() leaves one row per key and window behind, so a flood of distinct keys (IPs,
-- accounts) would grow rate_limits forever. The daily retention run deletes counters whose window started more
-- than a day ago; the longest window in use is one hour, so no live counter is ever touched.
create function public.prune_rate_limits()
returns int language sql security definer set search_path = public, pg_temp as $$
  with gone as (delete from rate_limits where window_start < now() - interval '1 day' returning 1)
  select count(*)::int from gone
$$;
revoke all on function public.prune_rate_limits() from public, anon, authenticated;
grant execute on function public.prune_rate_limits() to service_role;
