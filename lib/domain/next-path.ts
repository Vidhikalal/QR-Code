// Where /edit may send someone after signing in (the recap's "See your connections" link carries
// ?next=/me/connections). An allowlist, so the query string can never become an open redirect.
const ALLOWED = new Set(['/me', '/me/connections']);

export function safeNext(raw: string | null | undefined): string {
  return raw && ALLOWED.has(raw) ? raw : '/me';
}
