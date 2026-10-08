import { z } from 'zod';

// PLAN §6.3: mirrors every check on the profiles table, so the API answers 400 with a friendly reason
// instead of a database error. The database stays the authority (CLAUDE.md "constraints live in the DB").

export type BadgeRole = 'participant' | 'organizer' | 'mentor' | 'judge' | 'volunteer';
export const TOPIC_ROLES: readonly BadgeRole[] = ['organizer', 'mentor'];

// Postgres length() counts characters, not UTF-16 units.
const chars = (s: string) => [...s].length;

// Trimmed; an empty value clears the field (null).
const text = (max: number, min = 1) =>
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s === '' || (chars(s) >= min && chars(s) <= max), `${min}–${max} characters`)
    .transform((s) => (s === '' ? null : s))
    .nullable();

const pattern = (re: RegExp, message: string) =>
  z
    .string()
    .transform((s) => s.trim())
    .refine((s) => s === '' || re.test(s), message)
    .transform((s) => (s === '' ? null : s))
    .nullable();

export const LINKEDIN = /^https:\/\/(www\.)?linkedin\.com\/in\/[A-Za-z0-9_%-]+\/?$/;
export const GITHUB = /^https:\/\/(www\.)?github\.com\/[A-Za-z0-9-]{1,39}\/?$/;
export const WEBSITE = /^https:\/\/[^\s<>"]{4,200}$/;
export const DISCORD = /^[a-z0-9_.]{2,32}$/;

// Labels must already be trimmed (the DB checks x = btrim(x)); the UI trims each chip before sending.
const topics = z
  .array(z.string().refine((x) => x === x.trim() && chars(x) >= 1 && chars(x) <= 30, 'each topic 1–30 characters, no surrounding spaces'))
  .max(5, 'at most 5 topics');

export function profilePatchSchema(opts: { badgeRole: BadgeRole; extraRoles: boolean }) {
  const base = {
    nickname: text(40),
    pronouns: text(30),
    program: text(80),
    yearLabel: text(30),
    bio: text(280),
    linkedinUrl: pattern(LINKEDIN, 'a linkedin.com/in/… link starting with https://'),
    githubUrl: pattern(GITHUB, 'a github.com/… link starting with https://'),
    websiteUrl: pattern(WEBSITE, 'a link starting with https://'),
    visibility: z.enum(['public', 'hidden']),
    ...(TOPIC_ROLES.includes(opts.badgeRole) && { askMeAbout: topics }),
    ...(opts.extraRoles && { discordHandle: pattern(DISCORD, '2–32 lowercase letters, digits, _ or .') }),
  };
  return z.object(base).partial().strict();
}

export type ProfilePatch = z.infer<ReturnType<typeof profilePatchSchema>>;
