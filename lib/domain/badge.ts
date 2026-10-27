// SPEC §6.5. A badge UID is lowercase hex without separators, 4–10 bytes; Chrome reports
// serial numbers as "04:a1:b2:…". Not a secret (DECISION §6.5), but never logged in audit detail.
export const BADGE_UID_RE = /^(?:[0-9a-f]{2}){4,10}$/;

export function normalizeUid(input: string): string | null {
  const hex = input.trim().toLowerCase().replace(/[:\s-]/g, '');
  return BADGE_UID_RE.test(hex) ? hex : null;
}

/** Chrome's display form: "04a1b2c3" → "04:A1:B2:C3". */
export function formatUid(uid: string): string {
  return uid.toUpperCase().replace(/(..)(?!$)/g, '$1:');
}

// §6.5 tag payload: one URL record. `?tap` keeps tags written by the earlier datathon-badges app valid.
export function badgeUrl(origin: string, uid: string): string {
  return `${origin}/profile/${uid}?tap`;
}

// Never write http:// (e.g. localhost in dev) onto a physical tag: phones couldn't open it.
export function badgeWritable(origin: string): boolean {
  return origin.startsWith('https://');
}

// link_badge() results (§6.5).
export const LINK_CODES = ['LINKED', 'NOT_FOUND', 'BADGE_TAKEN'] as const;
export type LinkCode = (typeof LINK_CODES)[number];

// SPEC §6.5 (v0.10): what staff see after tapping a badge to link it (Participants page, scanner Manual search).
// A notice, never a green result screen (I-1). Anything unexpected (no answer, a 5xx) is "not linked".
export function linkNotice(code: string | undefined, uid: string, name: string): { tone: 'ok' | 'bad'; text: string } {
  if (code === 'LINKED') return { tone: 'ok', text: `✓ Badge ${formatUid(uid)} linked to ${name}.` };
  if (code === 'BADGE_TAKEN') return { tone: 'bad', text: `✕ Badge ${formatUid(uid)} is linked to someone else. Ask an organizer to move it.` };
  if (code === 'NOT_FOUND') return { tone: 'bad', text: `✕ ${name} isn’t in this event any more.` };
  return { tone: 'bad', text: '✕ Badge not linked. Try again.' };
}

// The networking form's fields carry these HTML patterns (v-flag syntax), so the browser refuses a typo before the
// form is sent: a refusal from the server reloads the form and loses everything typed in it. They follow the
// rules below (spaces around the value allowed, as the server trims them); the server stays the authority.
const SCHEME = '(?:[Hh][Tt][Tt][Pp][Ss]?:\\/\\/)?';
export const LINKEDIN_PATTERN = `\\s*${SCHEME}(?:[^\\s\\/?#@:]+\\.)?[Ll][Ii][Nn][Kk][Ee][Dd][Ii][Nn]\\.[Cc][Oo][Mm]\\/in\\/[\\w%\\-\\P{ASCII}]+\\/?(?:[?#]\\S*)?\\s*`;
export const DISCORD_PATTERN = '\\s*(?!.*\\.\\.)@?[A-Za-z0-9_.]{2,32}\\s*';
export const WEBSITE_PATTERN = `\\s*${SCHEME}[^\\s\\/?#@:]+\\.[^\\s\\/?#@:]+(?::\\d+)?(?:[\\/?#]\\S*)?\\s*`;

// §6.5 (v0.5): the LinkedIn an attendee types on /me. Accepts "linkedin.com/in/x", http, www. and country
// hosts, and returns https://www.linkedin.com/in/<handle>, the only form the participants check allows.
export function normalizeLinkedIn(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 200) return null;
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  const host = url.hostname.toLowerCase();
  const handle = /^\/in\/([A-Za-z0-9_%-]+)\/?$/.exec(url.pathname)?.[1];
  if ((host !== 'linkedin.com' && !host.endsWith('.linkedin.com')) || url.username || url.password || url.port || !handle) return null;
  return `https://www.linkedin.com/in/${handle}`;
}

// SPEC §6.5 (v0.9.2): a Discord username as Discord allows it (2–32 of a-z 0-9 _ ., no ".."), typed with or
// without "@" in any case. Null for anything else, including the retired "name#1234" form.
export function normalizeDiscord(input: string): string | null {
  const name = input.trim().replace(/^@/, '').toLowerCase();
  return /^(?!.*\.\.)[a-z0-9_.]{2,32}$/.test(name) ? name : null;
}

// SPEC §6.5 (v0.9.2): a personal website, http(s) only, https:// added when no scheme is typed. Null for
// other schemes, credentials, hosts without a dot (localhost) and anything over 300 characters once normalized
// (the field takes 200; https://, a trailing / and percent-encoding are added on top).
export function normalizeWebsite(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let url: URL;
  try {
    // A scheme is letters then ":"; "ada.dev:8443" is a host and port, not the scheme "ada.dev:".
    url = new URL(/^[a-z][a-z0-9+.-]*:(?!\d)/i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return null;
  }
  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || url.username || url.password || !url.hostname.includes('.')) return null;
  return url.href.length <= 300 ? url.href : null;
}
