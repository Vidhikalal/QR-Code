import { randomBytes } from 'node:crypto';

// SPEC F15 (v0.7): a team's join code. 32 symbols without look-alikes (no I, O, 0, 1); 8 of them are 40 bits.
// Not a secret: teams share it on purpose; it only lets someone join until the team is full.
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const JOIN_CODE_RE = /^[A-HJ-NP-Z2-9]{8}$/;

export function generateJoinCode(): string {
  return Array.from(randomBytes(8), (b) => ALPHABET[b % 32]).join(''); // 256 % 32 = 0: uniform
}

// What a hacker types: case, spaces and dashes don't matter.
export function normalizeJoinCode(raw: string): string | null {
  const code = raw.slice(0, 64).replace(/[\s-]/g, '').toUpperCase();
  return JOIN_CODE_RE.test(code) ? code : null;
}

export const formatJoinCode = (code: string) => `${code.slice(0, 4)}-${code.slice(4)}`;

export function parseTeamName(raw: string): string | null {
  const name = raw.trim();
  return name.length >= 1 && name.length <= 60 ? name : null;
}

// The admin "Add tracks, one per line" box: trimmed, blank lines dropped, repeats (any case) dropped.
export function parseTrackNames(text: string): string[] | null {
  const seen = new Set<string>();
  const names: string[] = [];
  for (const line of text.split(/\r?\n/)) {
    const name = line.trim();
    if (!name || seen.has(name.toLowerCase())) continue;
    if (name.length > 100) return null;
    seen.add(name.toLowerCase());
    names.push(name);
  }
  return names.length >= 1 && names.length <= 20 ? names : null;
}
