import type { BadgeRole } from './schema';
import { TOPIC_ROLES } from './schema';

// I-19: everything non-staff see about a badge holder goes through here. Pure. It can never carry an
// email, photo, dietary notes, status, scans, ids or staff notes: it only copies the fields below.

export interface ProfileFields {
  nickname: string | null;
  pronouns: string | null;
  program: string | null;
  yearLabel: string | null;
  bio: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  websiteUrl: string | null;
  discordHandle: string | null;
  askMeAbout: string[];
  visibility: 'public' | 'hidden';
  hiddenByStaffAt: string | null;
}

type Label = 'Organizer' | 'Mentor' | 'Judge' | 'Volunteer' | null;

export type PublicProfile =
  | { hidden: true; displayName: string; badgeRole: BadgeRole; label: Label; eventName: string }
  | {
      hidden: false;
      displayName: string;
      badgeRole: BadgeRole;
      label: Label;
      pronouns?: string;
      program?: string;
      yearLabel?: string;
      bio?: string;
      links: { linkedin?: string; github?: string; website?: string };
      discord?: string;
      askMeAbout: string[];
      eventName: string;
    };

const LABELS: Record<BadgeRole, Label> = { participant: null, organizer: 'Organizer', mentor: 'Mentor', judge: 'Judge', volunteer: 'Volunteer' };

/** D16: nickname, else "First L.". */
export function displayName(firstName: string, lastName: string, nickname: string | null | undefined): string {
  if (nickname) return nickname;
  const initial = [...lastName.trim()][0];
  return initial ? `${firstName} ${initial.toUpperCase()}.` : firstName;
}

const opt = <K extends string>(key: K, v: string | null) => (v ? ({ [key]: v } as Record<K, string>) : {});

export function toPublicProfile(input: {
  participant: { firstName: string; lastName: string; badgeRole: BadgeRole };
  profile: ProfileFields | null;
  eventName: string;
  /** FEATURE_EXTRA_BADGE_ROLES (PLAN Q2): Discord handles are shown only when it is on. */
  extraRoles: boolean;
}): PublicProfile {
  const { participant: pa, profile: pr, eventName } = input;
  const head = { displayName: displayName(pa.firstName, pa.lastName, pr?.nickname), badgeRole: pa.badgeRole, label: LABELS[pa.badgeRole], eventName };
  // Staff hiding wins over the owner's visibility (T-PROF-09).
  if (pr && (pr.hiddenByStaffAt !== null || pr.visibility === 'hidden')) return { hidden: true, ...head };
  return {
    hidden: false,
    ...head,
    ...opt('pronouns', pr?.pronouns ?? null),
    ...opt('program', pr?.program ?? null),
    ...opt('yearLabel', pr?.yearLabel ?? null),
    ...opt('bio', pr?.bio ?? null),
    links: { ...opt('linkedin', pr?.linkedinUrl ?? null), ...opt('github', pr?.githubUrl ?? null), ...opt('website', pr?.websiteUrl ?? null) },
    ...(input.extraRoles ? opt('discord', pr?.discordHandle ?? null) : {}),
    askMeAbout: pr && TOPIC_ROLES.includes(pa.badgeRole) ? [...pr.askMeAbout] : [],
  };
}
