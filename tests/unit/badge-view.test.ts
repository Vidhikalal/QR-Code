import { describe, expect, it } from 'vitest';
import { badgeView, type BadgeInput, type Viewer } from '@/lib/badge/view';
import type { ProfileFields } from '@/lib/profile/public';

const NOW = new Date('2026-10-10T12:00:00Z');
const EVENT = { id: 'e1', slug: 'hack', name: 'Hack Day', endsAt: '2026-10-11T00:00:00Z', retentionDays: 30 };
const fields: ProfileFields = {
  nickname: 'Lace',
  pronouns: null,
  program: null,
  yearLabel: null,
  bio: 'Engines.',
  linkedinUrl: null,
  githubUrl: null,
  websiteUrl: null,
  discordHandle: null,
  skills: [],
  lookingFor: [],
  // Organizers-only by default: T-BADGE-02 proves it never reaches a non-staff view.
  dietaryNotes: 'Vegan',
  accessibilityNotes: 'Step-free access',
  publicFields: ['pronouns', 'program', 'year', 'bio', 'links', 'skills', 'lookingFor', 'discord'],
  visibility: 'public',
  hiddenByStaffAt: null,
};
const holder = { participantId: 'p-ada', firstName: 'Ada', lastName: 'Lovelace', badgeRole: 'participant' as const, fields };
const staffExtras = {
  holder: { fullName: 'Ada Lovelace', badgeRole: 'participant', status: 'accepted', photoUrl: 'https://signed/x' },
  suggestion: { participantId: 'p-new', name: 'Nia New', admittedAt: '2026-10-10T11:59:46Z' },
  lastHolder: null,
};

const linked = (over: Partial<BadgeInput> = {}): BadgeInput => ({
  event: EVENT,
  tag: { id: 't1', label: 'B-0001', retiredAt: null },
  assignment: { id: 'a1', participantId: 'p-ada', assignedAt: '2026-10-10T11:59:00Z', assignedBy: 'u-vol' },
  holder,
  lastHolder: null,
  extraRoles: false,
  now: NOW,
  ...over,
  viewer: over.viewer ?? { kind: 'anonymous' },
});

const anon: Viewer = { kind: 'anonymous' };
const sameEventParticipant: Viewer = { kind: 'participant', participantId: 'p-bob', eventId: 'e1' };
const otherEventParticipant: Viewer = { kind: 'participant', participantId: 'p-x', eventId: 'e2' };
const owner: Viewer = { kind: 'participant', participantId: 'p-ada', eventId: 'e1' };
const vol: Viewer = { kind: 'staff', userId: 'u-vol', eventId: 'e1', role: 'volunteer' };
const org: Viewer = { kind: 'staff', userId: 'u-org', eventId: 'e1', role: 'organizer' };

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

describe('badgeView (PLAN §8.2)', () => {
  it('T-BADGE-01: unknown id → not_found for everyone', () => {
    for (const viewer of [anon, owner, org]) expect(badgeView({ ...linked({ viewer }), tag: null }).kind).toBe('not_found');
  });

  it('T-BADGE-01: registered, never linked → "not activated" for non-staff; the assign panel for staff', () => {
    const blank = (viewer: Viewer) => badgeView(linked({ viewer, assignment: null, holder: null, staffExtras: { ...staffExtras, holder: null } }));
    expect(blank(anon)).toEqual({ kind: 'unlinked', eventName: 'Hack Day', label: 'B-0001' });
    expect(blank(sameEventParticipant)).toEqual({ kind: 'unlinked', eventName: 'Hack Day', label: 'B-0001' });
    expect(blank(vol)).toMatchObject({ kind: 'unlinked', staff: { role: 'volunteer', eventSlug: 'hack', suggestion: { name: 'Nia New', secondsAgo: 14 } } });
  });

  it('T-BADGE-01: linked + public → profile; sign-in prompt for anonymous; owner tools for the owner; staff panel for staff', () => {
    const a = badgeView(linked({ viewer: anon }));
    expect(a).toMatchObject({ kind: 'linked', audience: 'anonymous', profile: { hidden: false, displayName: 'Lace', bio: 'Engines.' } });
    expect(a).not.toHaveProperty('staff');
    expect(badgeView(linked({ viewer: sameEventParticipant }))).toMatchObject({ audience: 'participant' });
    expect(badgeView(linked({ viewer: otherEventParticipant }))).toMatchObject({ audience: 'anonymous' });
    expect(badgeView(linked({ viewer: owner }))).toMatchObject({ audience: 'owner', ownerOnlyNote: false });
    const s = badgeView(linked({ viewer: org, staffExtras }));
    expect(s).toMatchObject({ audience: 'staff', staff: { holder: { fullName: 'Ada Lovelace' }, assignment: { id: 'a1', canUnlink: true }, hiddenBy: null } });
  });

  it('T-BADGE-01: linked + hidden → name only for others; the owner still sees everything with a note; staff see who hid it', () => {
    const hidden = { ...holder, fields: { ...fields, visibility: 'hidden' as const } };
    expect(badgeView(linked({ viewer: anon, holder: hidden }))).toMatchObject({ profile: { hidden: true, displayName: 'Lace' } });
    expect(badgeView(linked({ viewer: owner, holder: hidden }))).toMatchObject({ audience: 'owner', ownerOnlyNote: true, profile: { hidden: false, bio: 'Engines.' } });
    const byStaff = { ...holder, fields: { ...fields, hiddenByStaffAt: '2026-10-10T10:00:00Z' } };
    expect(badgeView(linked({ viewer: org, holder: byStaff, staffExtras }))).toMatchObject({ profile: { hidden: true }, staff: { hiddenBy: 'staff' } });
    expect(badgeView(linked({ viewer: org, holder: hidden, staffExtras }))).toMatchObject({ staff: { hiddenBy: 'owner' } });
  });

  it('T-BADGE-01: unlink is offered to organizers, and to the volunteer who linked it within 120 s', () => {
    const at = (assignedAt: string, viewer: Viewer) =>
      badgeView(linked({ viewer, staffExtras, assignment: { id: 'a1', participantId: 'p-ada', assignedAt, assignedBy: 'u-vol' } }));
    expect(at('2026-10-10T11:58:01Z', vol)).toMatchObject({ staff: { assignment: { canUnlink: true } } });
    expect(at('2026-10-10T11:57:59Z', vol)).toMatchObject({ staff: { assignment: { canUnlink: false } } });
    expect(at('2026-10-10T08:00:00Z', org)).toMatchObject({ staff: { assignment: { canUnlink: true } } });
  });

  it('T-BADGE-05: a retired badge reads differently per viewer', () => {
    const retired = (viewer: Viewer) =>
      badgeView(
        linked({
          viewer,
          tag: { id: 't1', label: 'B-0001', retiredAt: '2026-10-10T11:00:00Z' },
          assignment: null,
          holder: null,
          lastHolder: { participantId: 'p-ada', name: 'Ada Lovelace', currentLabel: 'B-0412' },
          staffExtras: { ...staffExtras, holder: null },
        }),
      );
    expect(retired(anon)).toEqual({ kind: 'retired', eventName: 'Hack Day' });
    expect(retired(sameEventParticipant)).toEqual({ kind: 'retired', eventName: 'Hack Day' });
    expect(retired(owner)).toEqual({ kind: 'retired', eventName: 'Hack Day', replacementLabel: 'B-0412' });
    expect(retired(vol)).toMatchObject({ kind: 'retired', staff: { retiredAt: '2026-10-10T11:00:00Z', current: { label: 'B-0412', holderName: 'Ada Lovelace' } } });
  });

  it('T-BADGE-06: after the retention window everyone sees "used at"; staff also see the deletion date', () => {
    const late = new Date('2026-11-11T00:00:00Z'); // ends Oct 11 + 30 days = Nov 10
    for (const viewer of [anon, sameEventParticipant, owner]) expect(badgeView(linked({ viewer, now: late }))).toEqual({ kind: 'used', eventName: 'Hack Day' });
    expect(badgeView(linked({ viewer: org, now: late, staffExtras }))).toEqual({ kind: 'used', eventName: 'Hack Day', profileDeletedOn: '2026-11-10T00:00:00.000Z' });
  });

  it('T-BADGE-07: an organizer tapping their own badge gets the owner view and the staff panel', () => {
    const self: Viewer = { kind: 'staff', userId: 'u-org', eventId: 'e1', role: 'organizer', participantId: 'p-ada' };
    expect(badgeView(linked({ viewer: self, staffExtras }))).toMatchObject({ audience: 'owner', staff: { role: 'organizer' } });
  });

  it('T-BADGE-03 (pure): staff of another event are not staff here', () => {
    const otherStaff: Viewer = { kind: 'staff', userId: 'u-x', eventId: 'e2', role: 'organizer' };
    expect(badgeView(linked({ viewer: otherStaff, staffExtras }))).not.toHaveProperty('staff');
  });

  it('T-BADGE-02 (pure): no non-staff view carries email, photo, dietary, status or scans keys, or a staff field', () => {
    const forbidden = /email|photo|dietary|accessib|^status$|scans|^staff$/i;
    const inputs = [linked(), linked({ assignment: null, holder: null }), linked({ tag: { id: 't', label: 'B', retiredAt: '2026-10-10T00:00:00Z' }, assignment: null })];
    for (const viewer of [anon, sameEventParticipant, otherEventParticipant, owner]) {
      for (const input of inputs) {
        const keys = keysDeep(badgeView({ ...input, viewer, staffExtras }));
        expect(keys.filter((k) => forbidden.test(k)), viewer.kind).toEqual([]);
      }
    }
  });

  it('Profiles 2026-10-13: the staff panel carries every field, including organizers-only notes; the public card does not', () => {
    const staffViewer: Viewer = { kind: 'staff', userId: 'u-vol', eventId: 'e1', role: 'volunteer' };
    const v = badgeView(linked({ viewer: staffViewer, staffExtras }));
    expect(v).toMatchObject({ kind: 'linked', staff: { profile: { dietary: 'Vegan', accessibility: 'Step-free access', bio: 'Engines.' } } });
    if (v.kind === 'linked') expect(v.profile).not.toHaveProperty('dietary');
  });

  it('PLAN F24 (V6): Connect status is offered to a signed-in attendee of the event, never to the owner or a stranger', () => {
    expect(badgeView(linked({ viewer: sameEventParticipant, connection: 'pending' }))).toMatchObject({ audience: 'participant', connect: { state: 'pending' } });
    expect(badgeView(linked({ viewer: owner, connection: 'none' }))).not.toHaveProperty('connect');
    expect(badgeView(linked({ viewer: anon }))).not.toHaveProperty('connect');
    // An organizer signed in both ways (staff session + their own participant session) can connect too.
    const hopped: Viewer = { kind: 'staff', userId: 'u-org', eventId: 'e1', role: 'organizer', participantId: 'p-org' };
    expect(badgeView(linked({ viewer: hopped, connection: 'mutual', staffExtras }))).toMatchObject({ audience: 'staff', connect: { state: 'mutual' } });
  });
});
