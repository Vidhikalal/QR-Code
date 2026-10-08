// PLAN T-PROF-03 / T-PROF-04: one table, run against the profiles table checks (int) and through
// lib/profile/schema.ts (unit). Both must accept and reject exactly the same rows.
export const PROFILE_CHECK_CASES: Array<{ name: string; patch: Record<string, unknown>; dbAccepts: boolean }> = [
  { name: 'github over http', patch: { githubUrl: 'http://github.com/ada' }, dbAccepts: false },
  { name: 'javascript: website', patch: { websiteUrl: 'javascript:alert(1)' }, dbAccepts: false },
  { name: 'untrimmed topic', patch: { askMeAbout: ['  spaces  '] }, dbAccepts: false },
  { name: 'six topics', patch: { askMeAbout: ['a', 'b', 'c', 'd', 'e', 'f'] }, dbAccepts: false },
  { name: 'empty topic', patch: { askMeAbout: [''] }, dbAccepts: false },
  { name: '31-char topic', patch: { askMeAbout: ['x'.repeat(31)] }, dbAccepts: false },
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
      askMeAbout: ['Rust', 'Math'],
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
  askMeAbout: 'ask_me_about',
  visibility: 'visibility',
};
