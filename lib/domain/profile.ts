import { normalizeLinkedIn } from './badge';

// SPEC F13/F14 (v0.6): what a hacker types on the RSVP Yes form and in their menu. A missing field is left
// unchanged; a blank LinkedIn or dietary note clears it. The emergency contact is all-or-nothing.
export interface ProfileInput {
  linkedin?: string;
  profilePublic?: boolean;
  dietaryNotes?: string;
  emergencyName?: string;
  emergencyPhone?: string;
  emergencyRelation?: string;
}

export interface ProfileFields {
  linkedinUrl?: string; // normalized, or '' to clear
  profilePublic?: boolean;
  dietaryNotes?: string; // '' clears
  emergency?: { name: string; phone: string; relation: string }; // relation '' = none
}

export type ProfileField = 'linkedin' | 'dietaryNotes' | 'emergencyName' | 'emergencyPhone' | 'emergencyRelation';

// The same character set as the participants check; at least 3 digits is checked only here.
const PHONE_RE = /^[0-9+() .-]{3,30}$/;

export function parseProfileInput(
  raw: ProfileInput,
  opts: { requireEmergency: boolean },
): { ok: true; value: ProfileFields } | { ok: false; field: ProfileField } {
  const value: ProfileFields = {};
  if (raw.linkedin !== undefined) {
    const linkedin = raw.linkedin.trim() === '' ? '' : normalizeLinkedIn(raw.linkedin);
    if (linkedin === null) return { ok: false, field: 'linkedin' };
    value.linkedinUrl = linkedin;
  }
  if (raw.profilePublic !== undefined) value.profilePublic = raw.profilePublic;
  if (raw.dietaryNotes !== undefined) {
    const dietary = raw.dietaryNotes.trim();
    if (dietary.length > 500) return { ok: false, field: 'dietaryNotes' };
    value.dietaryNotes = dietary;
  }
  const given = [raw.emergencyName, raw.emergencyPhone, raw.emergencyRelation].some((v) => v !== undefined);
  if (given || opts.requireEmergency) {
    const name = (raw.emergencyName ?? '').trim();
    const phone = (raw.emergencyPhone ?? '').trim();
    const relation = (raw.emergencyRelation ?? '').trim();
    if (name.length < 1 || name.length > 100) return { ok: false, field: 'emergencyName' };
    if (!PHONE_RE.test(phone) || (phone.match(/\d/g) ?? []).length < 3) return { ok: false, field: 'emergencyPhone' };
    if (relation.length > 60) return { ok: false, field: 'emergencyRelation' };
    value.emergency = { name, phone, relation };
  }
  return { ok: true, value };
}
