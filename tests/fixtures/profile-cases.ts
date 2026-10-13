// PLAN T-PROF-03 / T-PROF-04: one table, run against the profiles table checks (int) and through
// lib/profile/schema.ts (unit). Both must accept and reject exactly the same rows.
export const PROFILE_CHECK_CASES: Array<{ name: string; patch: Record<string, unknown>; dbAccepts: boolean }> = [
  { name: 'github over http', patch: { githubUrl: 'http://github.com/ada' }, dbAccepts: false },
  { name: 'javascript: website', patch: { websiteUrl: 'javascript:alert(1)' }, dbAccepts: false },
  { name: 'untrimmed skill', patch: { skills: ['  spaces  '] }, dbAccepts: false },
  { name: 'six skills', patch: { skills: ['a', 'b', 'c', 'd', 'e', 'f'] }, dbAccepts: false },
  { name: 'empty skill', patch: { skills: [''] }, dbAccepts: false },
  { name: 'unknown looking-for', patch: { lookingFor: ['cofounder'] }, dbAccepts: false },
  { name: 'unknown public field', patch: { publicFields: ['email'] }, dbAccepts: false },
  { name: '31-char skill', patch: { skills: ['x'.repeat(31)] }, dbAccepts: false },
  { name: 'linkedin company page', patch: { linkedinUrl: 'https://www.linkedin.com/company/x' }, dbAccepts: false },
  { name: 'discord with capitals', patch: { discordHandle: 'Ada' }, dbAccepts: false },
  {
    name: 'valid set',
    patch: {
      nickname: 'Ada',
      pronouns: 'she/her',
      bio: 'Engines.',
      githubUrl: 'https://github.com/ada',
      websiteUrl: 'https://ada.dev',
      linkedinUrl: 'https://linkedin.com/in/ada-l/',
      skills: ['Rust', 'Math'],
      lookingFor: ['team', 'internship'],
      publicFields: ['bio', 'skills', 'dietary'],
      visibility: 'hidden',
    },
    dbAccepts: true,
  },
];

/** camelCase patch key → profiles column. */
export const PROFILE_COLUMNS: Record<string, string> = {
  nickname: 'nickname',
  pronouns: 'pronouns',
  program: 'program',
  yearLabel: 'year_label',
  bio: 'bio',
  linkedinUrl: 'linkedin_url',
  githubUrl: 'github_url',
  websiteUrl: 'website_url',
  discordHandle: 'discord_handle',
  skills: 'ask_me_about',
  lookingFor: 'looking_for',
  publicFields: 'public_fields',
  visibility: 'visibility',
};
