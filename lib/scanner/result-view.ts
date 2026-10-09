import type { ScanResponse } from '@/lib/scan/schema';

// SPEC §10.2. Every state has an icon, a text label and a colour, never colour alone.
// I-1: 'green' is produced ONLY for a server response whose code is ACCEPTED, or (PLAN §10.2) a badge
// link the server confirmed: ASSIGNED / ALREADY_ASSIGNED.

export type Tone = 'green' | 'amber' | 'red';
export type CheckpointKind = 'door' | 'meal' | 'session' | 'custom';

// assign_tag() result codes (PLAN §6.5), as the door's "Tap a blank badge" step shows them.
export const LINK_CODES = [
  'ASSIGNED',
  'ALREADY_ASSIGNED',
  'TAG_IN_USE',
  'PARTICIPANT_HAS_TAG',
  'TAG_RETIRED',
  'TAG_NOT_FOUND',
  'TAG_WRONG_EVENT',
  'NOT_FOUND',
  'NOT_ACCEPTED',
  'FORBIDDEN',
] as const;
export type LinkCode = (typeof LINK_CODES)[number];

export type Outcome =
  | { kind: 'server'; data: ScanResponse }
  | { kind: 'malformed' }
  | { kind: 'network' }
  | { kind: 'rate_limited' }
  | { kind: 'link'; code: LinkCode; badgeLabel: string | null; personName: string; holderName?: string; currentLabel?: string | null }
  /** A badge read while no "Tap a blank badge" prompt is open (badge check-ins arrive with V5). */
  | { kind: 'badge_elsewhere' }
  /** An NFC tag without our URL. */
  | { kind: 'not_our_badge' };

export interface ViewContext {
  checkpointKind: CheckpointKind;
  checkpointName: string;
  timezone: string;
  now: Date;
}

export interface ResultView {
  tone: Tone;
  icon: '✓' | '⟳' | '✕' | '!' | '?';
  headline: string;
  detail?: string;
  /** Shown bold, e.g. dietary notes at a meal. */
  emphasis?: string;
  name?: string;
  photoUrl?: string | null;
  dismiss: { autoMs: number } | 'tap';
  action?: 'manual-search' | 'pick-checkpoint' | 'replace-badge';
  sound: 'chime' | 'buzz' | 'double';
}

const GREEN_MS = 2500;
const LINKED_MS = 2000;
const MALFORMED_MS = 1500;

const HEADLINE: Record<CheckpointKind, string> = { door: 'ADMIT', meal: 'SERVE', session: 'RECORDED', custom: 'RECORDED' };

function problem(tone: 'amber' | 'red', icon: ResultView['icon'], headline: string, extra: Partial<ResultView> = {}): ResultView {
  return { tone, icon, headline, dismiss: 'tap', sound: tone === 'red' ? 'buzz' : 'double', ...extra };
}

function clock(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
}

export function viewFor(outcome: Outcome, ctx: ViewContext): ResultView {
  if (outcome.kind === 'malformed') {
    return { tone: 'amber', icon: '?', headline: 'Not a Passline code', dismiss: { autoMs: MALFORMED_MS }, sound: 'double' };
  }
  if (outcome.kind === 'network') return problem('amber', '!', 'NO RESULT: do not admit yet. Rescan.');
  if (outcome.kind === 'rate_limited') return problem('amber', '!', 'Slow down', { detail: 'Too many scans. Wait a moment, then rescan.' });
  if (outcome.kind === 'not_our_badge') return { tone: 'amber', icon: '?', headline: 'Not a Passline badge', dismiss: { autoMs: MALFORMED_MS }, sound: 'double' };
  if (outcome.kind === 'badge_elsewhere') {
    return problem('amber', '!', 'Badge scanning at checkpoints comes next', { detail: 'Scan their pass or use manual search for now.', action: 'manual-search' });
  }
  if (outcome.kind === 'link') return linkView(outcome);

  const r = outcome.data;
  const who = r.participant ? { name: r.participant.displayName, photoUrl: r.participant.photoUrl } : {};

  switch (r.code) {
    case 'ACCEPTED': {
      const headline = HEADLINE[ctx.checkpointKind] + (r.replayed ? ' (confirmed)' : '');
      const dietary = ctx.checkpointKind === 'meal' ? r.participant?.dietaryNotes : null;
      return {
        tone: 'green',
        icon: '✓',
        headline,
        ...who,
        ...(dietary ? { emphasis: dietary } : {}),
        dismiss: { autoMs: GREEN_MS },
        sound: 'chime',
      };
    }
    case 'ALREADY_SCANNED': {
      const prev = r.previous;
      const ageS = prev ? Math.max(0, Math.round((ctx.now.getTime() - Date.parse(prev.scannedAt)) / 1000)) : Infinity;
      if (prev?.scannedByMe && ageS < 60) return problem('amber', '⟳', `You scanned this ${ageS} s ago`, who);
      const when = prev ? ` ${clock(prev.scannedAt, ctx.timezone)}` : '';
      const by = prev ? ` by ${prev.scannedByName ?? 'another volunteer'}` : '';
      return problem('red', '✕', `ALREADY SCANNED${when}${by}`, { ...who, detail: 'Check the photo' });
    }
    case 'NOT_FOUND':
      return problem('red', '✕', 'UNKNOWN CODE', { detail: 'Use manual search', action: 'manual-search' });
    case 'REVOKED':
      return r.reissued
        ? problem('amber', '!', 'OLD CODE', { ...who, detail: 'Ask for their newest email' })
        : problem('red', '✕', 'PASS CANCELLED', { ...who, detail: 'Send to an organizer' });
    case 'NOT_ACCEPTED':
      return problem('red', '✕', `NOT ACCEPTED (${r.participant?.status ?? 'unknown'})`, who);
    case 'WRONG_EVENT':
      return problem('red', '✕', `This pass is for ${r.otherEvent ?? 'another event'}`);
    case 'NOT_CHECKED_IN':
      return problem('amber', '!', 'Not checked in yet', { ...who, detail: 'Send to the entrance' });
    case 'CHECKPOINT_CLOSED':
      return problem('amber', '!', `${ctx.checkpointName} is closed`, who);
    case 'CAPACITY_REACHED':
      return problem('red', '✕', `FULL (${r.capacity ?? '?'})`, who);
    case 'FORBIDDEN':
    case 'CHECKPOINT_NOT_FOUND':
      return problem('red', '✕', 'No access', { detail: 'Re-select the event', action: 'pick-checkpoint' });
    case 'CLIENT_ID_CONFLICT':
      return problem('amber', '!', 'Rescan please');
  }
}

function linkView(o: Extract<Outcome, { kind: 'link' }>): ResultView {
  const badge = o.badgeLabel ?? 'Badge';
  switch (o.code) {
    case 'ASSIGNED':
    case 'ALREADY_ASSIGNED':
      return { tone: 'green', icon: '✓', headline: `${badge} linked to ${o.personName}`, dismiss: { autoMs: LINKED_MS }, sound: 'chime' };
    case 'TAG_IN_USE':
      return problem('red', '✕', `Badge belongs to ${o.holderName ?? 'someone else'}`, { detail: 'Pick another badge' });
    case 'PARTICIPANT_HAS_TAG':
      return problem('amber', '!', `${o.personName} already has ${o.currentLabel ?? 'a badge'}`, { detail: 'Replace it? Their old badge stops working.', action: 'replace-badge' });
    case 'TAG_RETIRED':
      return problem('red', '✕', 'Deactivated badge', { detail: 'Pick another badge' });
    case 'TAG_NOT_FOUND':
    case 'TAG_WRONG_EVENT':
      return problem('red', '✕', 'Not registered for this event', { detail: 'Pick another badge, or register this one on the Badges page' });
    case 'NOT_FOUND':
    case 'NOT_ACCEPTED':
      return problem('red', '✕', `${o.personName} can’t get a badge`, { detail: 'Send to an organizer' });
    case 'FORBIDDEN':
      return problem('red', '✕', 'No access', { detail: 'Re-select the event', action: 'pick-checkpoint' });
  }
}
