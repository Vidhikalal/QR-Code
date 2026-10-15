// Profiles demo feedback (2026-10-14): Year, dietary restrictions and "What I'm good at" are picked from
// lists, on /me and on the Google Form (apps-script/Setup.gs uses the same lists). Pure, shared by the
// client editor, the PATCH schema and the Sheet ingest.
//
// Google joins checkbox answers with ", " and appends the "Other" text last, so options must never
// contain a comma: an answer is matched against the options first, and whatever is left is one Other value.

export const YEAR_OPTIONS = ['1st year', '2nd year', '3rd year', '4th year', '5+ year', 'Alumni'] as const;
export type YearOption = (typeof YEAR_OPTIONS)[number];

export const DIETARY_OPTIONS = ['Vegetarian', 'Vegan', 'Halal', 'Kosher', 'Gluten-free', 'Dairy-free', 'Nut allergy', 'Shellfish allergy'] as const;
export type DietaryOption = (typeof DIETARY_OPTIONS)[number];

export const MAX_SKILLS = 3;
const MAX_SKILL_CHARS = 30; // the profiles.ask_me_about label check

export const SKILL_OPTIONS = [
  'Frontend',
  'Backend',
  'Full-stack',
  'Mobile apps',
  'AI / ML',
  'Data science',
  'Data analysis',
  'Databases',
  'Cloud / DevOps',
  'Cybersecurity',
  'Embedded / hardware',
  'Game development',
  'Blockchain / Web3',
  'Competitive programming',
  'UI/UX design',
  'Graphic design',
  'Product management',
  'Project management',
  'Research',
  'Pitching',
  'Public speaking',
  'Marketing',
  'Business strategy',
  'Writing',
] as const;

/** Splits a comma-joined answer into known options (in their own spelling, list order) and the rest. */
function splitAnswer<T extends string>(raw: string | null | undefined, options: readonly T[]): { chosen: T[]; other: string } {
  const byLower = new Map(options.map((o) => [o.toLowerCase(), o]));
  const chosen = new Set<T>();
  const rest: string[] = [];
  for (const part of (raw ?? '').split(',')) {
    const t = part.trim();
    if (!t) continue;
    const hit = byLower.get(t.toLowerCase());
    if (hit) chosen.add(hit);
    else rest.push(t);
  }
  return { chosen: options.filter((o) => chosen.has(o)), other: rest.join(', ') };
}

export function parseYear(raw: string | null | undefined): YearOption | null {
  const t = (raw ?? '').trim().toLowerCase();
  return YEAR_OPTIONS.find((y) => y.toLowerCase() === t) ?? null;
}

/** The stored dietary text: the chosen options in list order, then the Other text; nothing → null. */
export function formatDietary(chosen: readonly DietaryOption[], other: string): string | null {
  const parts = [...DIETARY_OPTIONS.filter((o) => chosen.includes(o)), other.trim()].filter((x) => x !== '');
  return parts.length ? parts.join(', ') : null;
}

export function parseDietary(text: string | null | undefined): { chosen: DietaryOption[]; other: string } {
  return splitAnswer(text, DIETARY_OPTIONS);
}

/** "What are you good at?" from the form: known options first, then the Other text as one skill; top 3. */
export function parseSkillsAnswer(raw: string | null | undefined): string[] {
  const { chosen, other } = splitAnswer(raw, SKILL_OPTIONS);
  const custom = [...other].slice(0, MAX_SKILL_CHARS).join('').trim();
  const out: string[] = [...chosen];
  if (custom && !out.some((s) => s.toLowerCase() === custom.toLowerCase())) out.push(custom);
  return out.slice(0, MAX_SKILLS);
}
