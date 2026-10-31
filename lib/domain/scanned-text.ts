// SPEC §6.4. Client-safe: runs in the scanner before any network request.

export type ParseResult = { ok: true; token: string } | { ok: false; reason: 'MALFORMED' };

const MAX_LENGTH = 2048;
const TOKEN = /^[A-Za-z0-9_-]{32}$/;
const MALFORMED: ParseResult = { ok: false, reason: 'MALFORMED' };
// v0.11.15: passes emailed before the move to station.sheridandatathon.com carry the old origin.
const LEGACY_ORIGINS = ['https://nfc.yvesdonato.com'];

export function parseScannedText(raw: string, appOrigin: string): ParseResult {
  if (typeof raw !== 'string' || raw.length > MAX_LENGTH) return MALFORMED;
  const text = raw.trim();
  // A literal prefix match: no regex built from the origin, so nothing in it needs escaping.
  const prefix = [appOrigin, ...LEGACY_ORIGINS].map((origin) => `${origin}/p#`).find((p) => text.startsWith(p));
  const candidate = prefix ? text.slice(prefix.length) : text;
  return TOKEN.test(candidate) ? { ok: true, token: candidate } : MALFORMED;
}
