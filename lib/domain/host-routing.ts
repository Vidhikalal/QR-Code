// PLAN §5.1 / I-23: one app, two hostnames. Staff pages answer only on the ADMIN host, participant
// pages only on the ME host. The staff actions a badge page needs answer on both and authorize
// exactly as on the ADMIN host. Pure: the proxy calls it with the request's Host header.

// Participant pages and APIs: ME host only.
const ME_ONLY = [/^\/p$/, /^\/edit$/, /^\/signin$/, /^\/me(\/.*)?$/, /^\/t(\/.*)?$/, /^\/api\/me(\/.*)?$/, /^\/api\/t(\/.*)?$/, /^\/api\/pass(\/.*)?$/, /^\/api\/signin(\/.*)?$/];

// Served on both hosts.
const SHARED = [
  /^\/api\/scan$/,
  /^\/api\/tags(\/.*)?$/,
  /^\/api\/stations$/,
  /^\/api\/participants\/[^/]+\/signin-code$/,
  /^\/api\/admin\/[^/]+\/participants\/[^/]+\/hide-profile$/,
  /^\/_next\/.*$/,
  /^\/favicon\.ico$/,
];

export type HostRoute = 'allow' | 'not_found';

export function routeForHost(o: { host: string; pathname: string; meOrigin: string; adminOrigin: string }): HostRoute {
  const me = new URL(o.meOrigin).host;
  const admin = new URL(o.adminOrigin).host;
  if (me === admin) return 'allow'; // single host (dev)
  const matches = (list: RegExp[]) => list.some((re) => re.test(o.pathname));
  if (o.host === me) return matches(ME_ONLY) || matches(SHARED) ? 'allow' : 'not_found';
  if (o.host === admin) return matches(ME_ONLY) ? 'not_found' : 'allow';
  // Any other host (a preview deployment, a dev tunnel) is not filtered; handlers still authorize.
  return 'allow';
}
