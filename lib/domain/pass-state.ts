// SPEC F5: what the pass page shows. Pure.

export type PassPageState = 'active' | 'replaced' | 'cancelled' | 'not_found';

export interface PassLookup {
  pass: { id: string; revokedAt: string | null; revokeReason: string | null };
  participant: {
    id: string;
    eventId: string;
    firstName: string;
    status: string;
    deleted: boolean;
    /** §6.5 badge profile opt-in. */
    profilePublic: boolean;
    hasLinkedin: boolean;
  };
  event: { name: string; venue: string; startsAt: string; timezone: string };
}

export function passState(lookup: PassLookup | null): PassPageState {
  if (!lookup) return 'not_found';
  // Checked first: a drain racing a withdrawal can leave an unrevoked pass on a non-accepted participant.
  if (lookup.participant.deleted || lookup.participant.status !== 'accepted') return 'cancelled';
  if (lookup.pass.revokedAt === null) return 'active';
  return lookup.pass.revokeReason === 'rotated' ? 'replaced' : 'cancelled';
}
