// PLAN §10.4: what a participant reads after pressing Connect. Pure.
export const CONNECT_CODES = ['PENDING', 'MUTUAL', 'ALREADY_PENDING', 'ALREADY_MUTUAL', 'SELF', 'NOT_CHECKED_IN', 'NOT_ELIGIBLE', 'NOT_FOUND', 'WRONG_EVENT', 'TAG_UNASSIGNED', 'TAG_REPLACED'] as const;
export type ConnectCode = (typeof CONNECT_CODES)[number];

export function connectCopy(code: ConnectCode, otherName: string | null): { ok: boolean; text: string } {
  const name = otherName ?? 'them';
  switch (code) {
    case 'PENDING':
      return { ok: true, text: `Sent! It counts once ${name} taps your badge too.` };
    case 'MUTUAL':
      return { ok: true, text: `You’re connected with ${name}.` };
    case 'ALREADY_PENDING':
      return { ok: true, text: `Waiting for ${name} to tap your badge.` };
    case 'ALREADY_MUTUAL':
      return { ok: true, text: 'You’re already connected.' };
    case 'SELF':
      return { ok: false, text: 'That’s your own badge.' };
    case 'NOT_CHECKED_IN':
      return { ok: false, text: 'Check in at the door first.' };
    case 'NOT_ELIGIBLE':
      return { ok: false, text: 'Your registration isn’t active. Ask an organizer.' };
    default:
      return { ok: false, text: 'This badge can’t be connected.' };
  }
}
