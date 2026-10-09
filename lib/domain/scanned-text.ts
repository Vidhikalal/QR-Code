import { parseTagUrl } from '@/lib/badge/tags';

// SPEC §6.4 + PLAN §11.3. Client-safe: runs in the scanner before any network request. A camera can see
// a QR pass (`${APP_ORIGIN}/p#<token>`, or a bare token) or a badge's printed QR (`${APP_ORIGIN}/t/<id>`).

export type ParseResult =
  | { ok: true; kind: 'pass'; token: string }
  | { ok: true; kind: 'badge'; publicId: string }
  | { ok: false; reason: 'MALFORMED' };

const MAX_LENGTH = 2048;
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const MALFORMED: ParseResult = { ok: false, reason: 'MALFORMED' };

export function parseScannedText(raw: string, appOrigin: string): ParseResult {
  if (typeof raw !== 'string' || raw.length > MAX_LENGTH) return MALFORMED;
  const text = raw.trim();
  const badge = parseTagUrl(text, appOrigin);
  if (badge.ok) return { ok: true, kind: 'badge', publicId: badge.publicId };
  // A literal prefix match: no regex built from the origin, so nothing in it needs escaping.
  const prefix = `${appOrigin}/p#`;
  const candidate = text.startsWith(prefix) ? text.slice(prefix.length) : text;
  return TOKEN.test(candidate) ? { ok: true, kind: 'pass', token: candidate } : MALFORMED;
}
