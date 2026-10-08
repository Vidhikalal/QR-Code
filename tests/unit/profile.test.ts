import { describe, expect, it } from 'vitest';
import { profilePatchSchema } from '@/lib/profile/schema';
import { PROFILE_CHECK_CASES } from '../fixtures/profile-cases';
import { toPublicProfile, type ProfileFields } from '@/lib/profile/public';

const P = profilePatchSchema({ badgeRole: 'participant', extraRoles: false });
const ORG = profilePatchSchema({ badgeRole: 'organizer', extraRoles: false });
const ok = (s: typeof P, v: unknown) => s.safeParse(v).success;

describe('profile schema mirrors the profiles table checks (PLAN §6.3)', () => {
  it('T-PROF-04: the shared case table is accepted/rejected exactly as the DB does', () => {
    // Every field enabled, so each row is judged on its value, not on whether the key is allowed.
    const all = profilePatchSchema({ badgeRole: 'organizer', extraRoles: true });
    for (const c of PROFILE_CHECK_CASES) expect(ok(all, c.patch), c.name).toBe(c.dbAccepts);
  });

  it('T-PROF-04: lengths, URL schemes and handles', () => {
    expect(ok(P, { nickname: 'a'.repeat(40) })).toBe(true);
    expect(ok(P, { nickname: 'a'.repeat(41) })).toBe(false);
    expect(ok(P, { bio: 'é'.repeat(280) })).toBe(true);
    expect(ok(P, { bio: '😀'.repeat(280) })).toBe(true); // characters, like Postgres length(), not UTF-16 units
    expect(ok(P, { bio: 'x'.repeat(281) })).toBe(false);
    expect(ok(P, { linkedinUrl: 'https://www.linkedin.com/in/ada-l/' })).toBe(true);
    expect(ok(P, { linkedinUrl: 'https://linkedin.com/company/x' })).toBe(false);
    expect(ok(P, { githubUrl: 'https://github.com/ada' })).toBe(true);
    expect(ok(P, { websiteUrl: 'https://ada.dev/a b' })).toBe(false);
    expect(ok(P, { websiteUrl: 'https://ada.dev/"><script>' })).toBe(false);
    expect(ok(P, { visibility: 'hidden' })).toBe(true);
    expect(ok(P, { visibility: 'secret' })).toBe(false);
    expect(ok(P, { nope: 1 })).toBe(false);
  });

  it('T-PROF-04: trims text, and an empty field clears it (null)', () => {
    expect(P.parse({ nickname: '  Ada  ', pronouns: '   ', bio: '' })).toEqual({ nickname: 'Ada', pronouns: null, bio: null });
  });

  it('PLAN §6.3: "Ask me about…" only for organizers and mentors; Discord only with FEATURE_EXTRA_BADGE_ROLES', () => {
    expect(ok(P, { askMeAbout: ['Rust'] })).toBe(false);
    expect(ok(ORG, { askMeAbout: ['Rust'] })).toBe(true);
    expect(ok(profilePatchSchema({ badgeRole: 'mentor', extraRoles: true }), { askMeAbout: ['Rust'] })).toBe(true);
    expect(ok(ORG, { discordHandle: 'ada.l' })).toBe(false);
    expect(ok(profilePatchSchema({ badgeRole: 'participant', extraRoles: true }), { discordHandle: 'ada.l' })).toBe(true);
  });
});

const base = { firstName: 'Ada', lastName: 'Lovelace', badgeRole: 'participant' as const };
const full: ProfileFields = {
  nickname: null,
  pronouns: 'she/her',
  program: 'CS',
  yearLabel: '3rd year',
  bio: 'Engines.',
  linkedinUrl: 'https://www.linkedin.com/in/ada-l',
  githubUrl: 'https://github.com/ada',
  websiteUrl: null,
  discordHandle: 'ada.l',
  askMeAbout: ['Rust', 'Math'],
  visibility: 'public',
  hiddenByStaffAt: null,
};

function keysDeep(v: unknown, out: string[] = []): string[] {
  if (Array.isArray(v)) v.forEach((x) => keysDeep(x, out));
  else if (v && typeof v === 'object') {
    for (const [k, x] of Object.entries(v)) {
      out.push(k);
      keysDeep(x, out);
    }
  }
  return out;
}

describe('toPublicProfile (PLAN §8.3, I-19)', () => {
  it('D16: the display name is the nickname, else "First L."', () => {
    expect(toPublicProfile({ participant: base, profile: full, eventName: 'Hack Day', extraRoles: false }).displayName).toBe('Ada L.');
    expect(toPublicProfile({ participant: base, profile: { ...full, nickname: 'Countess' }, eventName: 'Hack Day', extraRoles: false }).displayName).toBe('Countess');
    expect(toPublicProfile({ participant: { ...base, lastName: '' }, profile: null, eventName: 'Hack Day', extraRoles: false }).displayName).toBe('Ada');
  });

  it('PLAN §8.3: links, labels, and topics/Discord only where allowed', () => {
    const p = toPublicProfile({ participant: base, profile: full, eventName: 'Hack Day', extraRoles: false });
    expect(p).toEqual({
      hidden: false,
      displayName: 'Ada L.',
      badgeRole: 'participant',
      label: null,
      pronouns: 'she/her',
      program: 'CS',
      yearLabel: '3rd year',
      bio: 'Engines.',
      links: { linkedin: 'https://www.linkedin.com/in/ada-l', github: 'https://github.com/ada' },
      askMeAbout: [],
      eventName: 'Hack Day',
    });
    const org = toPublicProfile({ participant: { ...base, badgeRole: 'organizer' }, profile: full, eventName: 'Hack Day', extraRoles: true });
    expect(org).toMatchObject({ label: 'Organizer', askMeAbout: ['Rust', 'Math'], discord: 'ada.l' });
  });

  it('T-PROF-08 / T-PROF-09: hidden by the owner, or by staff (which wins over public), shows the name only', () => {
    const byOwner = toPublicProfile({ participant: base, profile: { ...full, visibility: 'hidden' }, eventName: 'Hack Day', extraRoles: false });
    const byStaff = toPublicProfile({ participant: base, profile: { ...full, hiddenByStaffAt: '2026-10-08T12:00:00Z' }, eventName: 'Hack Day', extraRoles: false });
    for (const p of [byOwner, byStaff]) expect(p).toEqual({ hidden: true, displayName: 'Ada L.', badgeRole: 'participant', label: null, eventName: 'Hack Day' });
  });

  it('T-BADGE-02 (profile part): no output ever carries an email, photo, dietary, status, scan or id key', () => {
    const forbidden = /email|photo|dietary|status|scans|^id$|Id$/i;
    for (const badgeRole of ['participant', 'organizer', 'mentor', 'judge', 'volunteer'] as const) {
      for (const extraRoles of [false, true]) {
        for (const profile of [null, full, { ...full, visibility: 'hidden' as const }, { ...full, hiddenByStaffAt: 'x' }]) {
          const keys = keysDeep(toPublicProfile({ participant: { ...base, badgeRole }, profile, eventName: 'E', extraRoles }));
          expect(keys.filter((k) => forbidden.test(k)), `${badgeRole} ${String(extraRoles)}`).toEqual([]);
        }
      }
    }
  });
});
