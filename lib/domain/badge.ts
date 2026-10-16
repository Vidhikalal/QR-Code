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
