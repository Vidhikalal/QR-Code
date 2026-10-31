// Links in the "you're in" email (SPEC §12, v0.9).
export const DISCORD_URL = 'https://discord.gg/GyQMxefe9A';
export const HACKER_PACKAGE_URL = 'https://drive.google.com/file/d/1MA4bUqKdMO4qwI46000dJJxrNsmaIIDR/view?usp=sharing';
export const GOOGLE_GROUP_URL = 'https://groups.google.com/g/sheridandatathon';

// v0.11.23 (owner's request): emails give the datathon its full name; the app keeps the short event name.
// shortcut: keyed by the prod event's slug in code; move it to an events column if another event needs one.
const FULL_NAMES: Record<string, string> = { dashboard: 'Sheridan Datathon 2026' };
export const emailEventName = (slug: string, name: string): string => FULL_NAMES[slug] ?? name;
