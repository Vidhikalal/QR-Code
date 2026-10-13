import { normalizeEmail, toSearchText } from './normalize';

// SPEC F3 / §9.2 / Appendix A. Pure row handling for the Sheet bridge.

export type IngestStatus = 'pending' | 'accepted' | 'waitlisted' | 'rejected' | 'withdrawn';

export interface SheetRowInput {
  external_id?: string;
  email?: string;
  first_name?: string;
  last_name?: string;
  dietary_notes?: string;
  linkedin_url?: string;
  // Profiles part B (all optional; old Sheets without these columns send nothing or '').
  accessibility_notes?: string;
  skills?: string;
  looking_for?: string;
  status?: string;
}

export interface CleanRow {
  externalId: string;
  email: string;
  firstName: string;
  lastName: string;
  searchText: string;
  dietaryNotes: string | null;
  linkedinUrl: string | null;
  accessibilityNotes: string | null;
  skills: string[];
  lookingFor: LookingFor[];
  status: IngestStatus;
}

export type LookingFor = 'team' | 'mentor' | 'internship' | 'job' | 'networking';

export type RowValidation = { ok: true; row: CleanRow } | { ok: false; result: `INVALID:${string}` };

const SHEET_STATUSES = ['accepted', 'waitlisted', 'rejected', 'withdrawn'] as const;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same pattern as the participants.linkedin_url check constraint (§5).
const LINKEDIN = /^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?$/;

// Postgres length() counts characters (code points), not UTF-16 units.
const chars = (s: string) => [...s].length;

export function normalizeStatus(raw: string | undefined): IngestStatus | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (s === '') return 'pending';
  return (SHEET_STATUSES as readonly string[]).includes(s) ? (s as IngestStatus) : null;
}

const MAX_SKILLS = 5;
const MAX_SKILL_CHARS = 30;

/** "React, design; Pitching" → up to 5 trimmed, case-insensitively unique tags of ≤ 30 characters. */
export function parseSkills(raw: string | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const part of (raw ?? '').split(/[,;\n]/)) {
    const t = part.trim();
    if (!t || chars(t) > MAX_SKILL_CHARS || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    out.push(t);
    if (out.length === MAX_SKILLS) break;
  }
  return out;
}

// Google Forms writes checkbox answers as "A team, A mentor"; match by keyword so wording tweaks survive.
const LOOKING_FOR_KEYWORDS: Array<[LookingFor, RegExp]> = [
  ['team', /\bteam/i],
  ['mentor', /\bmentor/i],
  ['internship', /\bintern/i],
  ['job', /\bjob/i],
  ['networking', /\bnetwork/i],
];

export function parseLookingFor(raw: string | undefined): LookingFor[] {
  const out: LookingFor[] = [];
  for (const part of (raw ?? '').split(',')) {
    const hit = LOOKING_FOR_KEYWORDS.find(([, re]) => re.test(part))?.[0];
    if (hit && !out.includes(hit)) out.push(hit);
  }
  return out;
}

export function validateRow(input: SheetRowInput): RowValidation {
  const externalId = (input.external_id ?? '').trim();
  const email = normalizeEmail(input.email ?? '');
  const firstName = (input.first_name ?? '').trim();
  const lastName = (input.last_name ?? '').trim();
  const dietary = (input.dietary_notes ?? '').trim();
  const linkedin = (input.linkedin_url ?? '').trim();
  const accessibility = (input.accessibility_notes ?? '').trim();
  const status = normalizeStatus(input.status);

  const bad: string[] = [];
  if (externalId === '' || chars(externalId) > 200) bad.push('external_id');
  if (!EMAIL.test(email) || chars(email) > 320) bad.push('email');
  if (chars(firstName) < 1 || chars(firstName) > 100) bad.push('first_name');
  if (chars(lastName) > 100) bad.push('last_name');
  if (chars(dietary) > 500) bad.push('dietary_notes');
  if (chars(accessibility) > 500) bad.push('accessibility_notes');
  if (status === null) bad.push('status');
  if (bad.length > 0 || status === null) return { ok: false, result: `INVALID:${bad.join(',')}` };

  return {
    ok: true,
    row: {
      externalId,
      email,
      firstName,
      lastName,
      searchText: toSearchText(`${firstName} ${lastName}`),
      dietaryNotes: dietary === '' ? null : dietary,
      // DECISION §9.2: an invalid LinkedIn URL is dropped, not an INVALID row.
      linkedinUrl: LINKEDIN.test(linkedin) ? linkedin : null,
      accessibilityNotes: accessibility === '' ? null : accessibility,
      // Optional answers: bad entries are dropped, never an INVALID row (like LinkedIn).
      skills: parseSkills(input.skills),
      lookingFor: parseLookingFor(input.looking_for),
      status,
    },
  };
}

// Appendix A: the form's response tab and header names.
export const SHEET_TAB = 'Form Responses 1';

// Appendix A header names. Rows are found by header, never by column position (T-GAS-07).
export const SHEET_HEADERS = {
  external_id: 'Applicant ID',
  email: 'Email Address',
  first_name: 'First Name',
  last_name: 'Last Name',
  dietary_notes: 'Dietary Restrictions',
  linkedin_url: 'LinkedIn URL',
  accessibility_notes: 'Accessibility or health needs',
  skills: 'What are you good at?',
  looking_for: 'What are you looking for?',
  status: 'Status',
} as const satisfies Record<keyof SheetRowInput, string>;

const REQUIRED: Array<keyof SheetRowInput> = ['external_id', 'email', 'first_name', 'status'];

export function mapSheetValues(values: string[][]): Array<Required<SheetRowInput>> {
  const [header = [], ...data] = values;
  const index = new Map(header.map((h, i) => [String(h).trim(), i]));
  for (const key of REQUIRED) {
    if (!index.has(SHEET_HEADERS[key])) throw new Error(`Missing header: ${SHEET_HEADERS[key]}`);
  }
  const keys = Object.keys(SHEET_HEADERS) as Array<keyof SheetRowInput>;
  const cell = (row: string[], key: keyof SheetRowInput) => {
    const i = index.get(SHEET_HEADERS[key]);
    return i === undefined ? '' : String(row[i] ?? '').trim();
  };
  return data
    .map((row) => Object.fromEntries(keys.map((k) => [k, cell(row, k)])) as Required<SheetRowInput>)
    .filter((r) => keys.some((k) => r[k] !== ''));
}

// F10: organizers paste either the Sheet's id or its docs.google.com URL.
const SHEET_ID = /^[A-Za-z0-9_-]{20,100}$/;
const SHEET_URL = /^https:\/\/docs\.google\.com\/spreadsheets\/d\/([A-Za-z0-9_-]{20,100})(?:[/?#].*)?$/;

export function parseSheetId(input: string): string | null {
  const s = input.trim();
  if (SHEET_ID.test(s)) return s;
  return SHEET_URL.exec(s)?.[1] ?? null;
}
