import type { BadgeRole, PublicField } from './schema';

// I-19: everything non-staff see about a badge holder goes through here. Pure. It never carries an
// email, photo, status, scans, ids or staff notes. Each field appears only when the owner listed it in
// `publicFields` (profiles 2026-10-13); dietary and accessibility notes are off by default and appear
// only when the owner opts in. The staff audience sees every field, whatever the owner chose.

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
  /** "What I'm good at" (profiles.ask_me_about), every role. */
  skills: string[];
  lookingFor: string[];
  /** From the participant row (shared with meal check-ins and retention). */
  dietaryNotes: string | null;
  accessibilityNotes: string | null;
  publicFields: PublicField[];
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
      skills: string[];
      lookingFor: string[];
      dietary?: string;
      accessibility?: string;
      eventName: string;
    };

const LABELS: Record<BadgeRole, Label> = { participant: null, organizer: 'Organizer', mentor: 'Mentor', judge: 'Judge', volunteer: 'Volunteer' };

/** D16: nickname, else "First L.". */
export function displayName(firstName: string, lastName: string, nickname: string | null | undefined): string {
  if (nickname) return nickname;
  const initial = [...lastName.trim()][0];
  return initial ? `${firstName} ${initial.toUpperCase()}.` : firstName;
}

const opt = <K extends string>(key: K, v: string | null | undefined) => (v ? ({ [key]: v } as Record<K, string>) : {});

export function toPublicProfile(input: {
  participant: { firstName: string; lastName: string; badgeRole: BadgeRole };
  profile: ProfileFields | null;
  eventName: string;
  /** FEATURE_EXTRA_BADGE_ROLES (PLAN Q2): Discord handles are shown only when it is on. */
  extraRoles: boolean;
  /** 'staff': organizers and volunteers of the event see every field, hidden or not. */
  audience?: 'public' | 'staff';
}): PublicProfile {
  const { participant: pa, profile: pr, eventName } = input;
  const staff = input.audience === 'staff';
  const head = { displayName: displayName(pa.firstName, pa.lastName, pr?.nickname), badgeRole: pa.badgeRole, label: LABELS[pa.badgeRole], eventName };
  // Staff hiding wins over the owner's visibility (T-PROF-09); neither applies to staff themselves.
  if (!staff && pr && (pr.hiddenByStaffAt !== null || pr.visibility === 'hidden')) return { hidden: true, ...head };
  const show = (f: PublicField) => staff || (pr?.publicFields.includes(f) ?? false);
  return {
    hidden: false,
    ...head,
    ...(show('pronouns') ? opt('pronouns', pr?.pronouns) : {}),
    ...(show('program') ? opt('program', pr?.program) : {}),
    ...(show('year') ? opt('yearLabel', pr?.yearLabel) : {}),
    ...(show('bio') ? opt('bio', pr?.bio) : {}),
    links: show('links') ? { ...opt('linkedin', pr?.linkedinUrl), ...opt('github', pr?.githubUrl), ...opt('website', pr?.websiteUrl) } : {},
    ...(input.extraRoles && show('discord') ? opt('discord', pr?.discordHandle) : {}),
    skills: show('skills') && pr ? [...pr.skills] : [],
    lookingFor: show('lookingFor') && pr ? [...pr.lookingFor] : [],
    ...(show('dietary') ? opt('dietary', pr?.dietaryNotes) : {}),
    ...(show('accessibility') ? opt('accessibility', pr?.accessibilityNotes) : {}),
  };
}
