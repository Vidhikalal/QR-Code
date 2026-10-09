import { describe, expect, it } from 'vitest';
import { SCAN_CODES, type ScanCode } from '@/lib/domain/scan-codes';
import { LINK_CODES, viewFor, type LinkCode, type Outcome, type ViewContext } from '@/lib/scanner/result-view';
import type { ScanResponse } from '@/lib/scan/schema';

const now = new Date('2026-10-03T16:03:20Z');
const ctx = (kind: ViewContext['checkpointKind'] = 'door'): ViewContext => ({
  checkpointKind: kind,
  checkpointName: kind === 'door' ? 'Door' : 'Lunch Sat',
  timezone: 'America/Toronto',
  now,
});
const participant = { id: 'p1', displayName: 'Ada Lovelace', photoUrl: 'https://x/p.jpg', status: 'accepted', dietaryNotes: null };
const server = (data: Partial<ScanResponse> & { code: ScanCode }) => ({ kind: 'server' as const, data: { serverTime: now.toISOString(), ...data } });

describe('result screen mapping (SPEC §10.2)', () => {
  it('T-SCUI-03: ACCEPTED headlines per checkpoint kind, green, auto-dismiss 2.5 s, chime', () => {
    expect(viewFor(server({ code: 'ACCEPTED', participant }), ctx('door'))).toMatchObject({
      tone: 'green', icon: '✓', headline: 'ADMIT', name: 'Ada Lovelace', photoUrl: 'https://x/p.jpg', dismiss: { autoMs: 2500 }, sound: 'chime',
    });
    const meal = viewFor(server({ code: 'ACCEPTED', participant: { ...participant, dietaryNotes: 'Vegan, nut allergy' } }), ctx('meal'));
    expect(meal).toMatchObject({ tone: 'green', headline: 'SERVE', emphasis: 'Vegan, nut allergy' });
    expect(viewFor(server({ code: 'ACCEPTED', participant }), ctx('session')).headline).toBe('RECORDED');
    expect(viewFor(server({ code: 'ACCEPTED', participant }), ctx('custom')).headline).toBe('RECORDED');
    expect(viewFor(server({ code: 'ACCEPTED', replayed: true, participant }), ctx('door'))).toMatchObject({
      tone: 'green', headline: 'ADMIT (confirmed)', dismiss: { autoMs: 2500 },
    });
  });

  it('T-SCUI-12: ALREADY_SCANNED by me < 60 s is amber; by me ≥ 60 s or by someone else is red with time and name', () => {
    const at = (secondsAgo: number) => new Date(now.getTime() - secondsAgo * 1000).toISOString();
    expect(viewFor(server({ code: 'ALREADY_SCANNED', participant, previous: { scannedAt: at(8), scannedByName: 'Me', scannedByMe: true } }), ctx())).toMatchObject({
      tone: 'amber', icon: '⟳', headline: 'You scanned this 8 s ago', dismiss: 'tap', sound: 'double',
    });
    const old = viewFor(server({ code: 'ALREADY_SCANNED', participant, previous: { scannedAt: at(90), scannedByName: 'Me', scannedByMe: true } }), ctx());
    expect(old).toMatchObject({ tone: 'red', icon: '✕', headline: 'ALREADY SCANNED 12:01 PM by Me', dismiss: 'tap', sound: 'buzz' });
    const other = viewFor(server({ code: 'ALREADY_SCANNED', participant, previous: { scannedAt: at(17), scannedByName: 'Maya', scannedByMe: false } }), ctx());
    expect(other).toMatchObject({ tone: 'red', headline: 'ALREADY SCANNED 12:03 PM by Maya', detail: 'Check the photo', photoUrl: 'https://x/p.jpg' });
  });

  it('T-SCUI-03: every problem code has its §10.2 tone, icon, text and requires a tap', () => {
    const cases: Array<[Parameters<typeof viewFor>[0], object]> = [
      [server({ code: 'NOT_FOUND' }), { tone: 'red', icon: '✕', headline: 'UNKNOWN CODE', detail: 'Use manual search', action: 'manual-search' }],
      [server({ code: 'REVOKED', reissued: true, participant }), { tone: 'amber', icon: '!', headline: 'OLD CODE', detail: 'Ask for their newest email' }],
      [server({ code: 'REVOKED', reissued: false, participant }), { tone: 'red', icon: '✕', headline: 'PASS CANCELLED', detail: 'Send to an organizer' }],
      [server({ code: 'NOT_ACCEPTED', participant: { ...participant, status: 'waitlisted' } }), { tone: 'red', icon: '✕', headline: 'NOT ACCEPTED (waitlisted)' }],
      [server({ code: 'WRONG_EVENT', otherEvent: 'Design Day' }), { tone: 'red', icon: '✕', headline: 'This pass is for Design Day' }],
      [server({ code: 'NOT_CHECKED_IN', participant }), { tone: 'amber', icon: '!', headline: 'Not checked in yet', detail: 'Send to the entrance' }],
      [server({ code: 'CHECKPOINT_CLOSED', participant }), { tone: 'amber', icon: '!', headline: 'Door is closed' }],
      [server({ code: 'CAPACITY_REACHED', participant, capacity: 40 }), { tone: 'red', icon: '✕', headline: 'FULL (40)' }],
      [server({ code: 'FORBIDDEN' }), { tone: 'red', icon: '✕', headline: 'No access', detail: 'Re-select the event', action: 'pick-checkpoint' }],
      [server({ code: 'CHECKPOINT_NOT_FOUND' }), { tone: 'red', icon: '✕', headline: 'No access', action: 'pick-checkpoint' }],
      [server({ code: 'CLIENT_ID_CONFLICT' }), { tone: 'amber', icon: '!', headline: 'Rescan please' }],
      [{ kind: 'network' }, { tone: 'amber', icon: '!', headline: 'NO RESULT: do not admit yet. Rescan.' }],
      [{ kind: 'rate_limited' }, { tone: 'amber', icon: '!', headline: 'Slow down' }],
    ];
    for (const [outcome, expected] of cases) {
      const v = viewFor(outcome, ctx());
      expect(v, JSON.stringify(outcome)).toMatchObject({ ...expected, dismiss: 'tap' });
      expect(v.sound).toBe(v.tone === 'red' ? 'buzz' : 'double');
    }
  });

  it('T-SCUI-06: MALFORMED is amber "?" and auto-dismisses after 1.5 s', () => {
    expect(viewFor({ kind: 'malformed' }, ctx())).toMatchObject({ tone: 'amber', icon: '?', headline: 'Not a Passline code', dismiss: { autoMs: 1500 } });
  });

  it('I-1: nothing but a server ACCEPTED is ever green', () => {
    for (const code of SCAN_CODES.filter((c) => c !== 'ACCEPTED')) {
      expect(viewFor(server({ code, participant, reissued: true, previous: { scannedAt: now.toISOString(), scannedByName: 'x', scannedByMe: true } }), ctx()).tone).not.toBe('green');
    }
    for (const kind of ['malformed', 'network', 'rate_limited'] as const) expect(viewFor({ kind }, ctx()).tone).not.toBe('green');
  });

  it('PLAN §10.2: badge link outcomes at the door', () => {
    const link = (code: LinkCode, extra: Partial<Extract<Outcome, { kind: 'link' }>> = {}) =>
      viewFor({ kind: 'link', code, badgeLabel: 'B-0412', personName: 'Ada Lovelace', ...extra }, ctx());
    expect(link('ASSIGNED')).toMatchObject({ tone: 'green', icon: '✓', headline: 'B-0412 linked to Ada Lovelace', dismiss: { autoMs: 2000 }, sound: 'chime' });
    expect(link('ALREADY_ASSIGNED')).toMatchObject({ tone: 'green', headline: 'B-0412 linked to Ada Lovelace' });
    expect(link('TAG_IN_USE', { holderName: 'Sam Smith' })).toMatchObject({ tone: 'red', icon: '✕', headline: 'Badge belongs to Sam Smith', detail: 'Pick another badge', dismiss: 'tap' });
    expect(link('PARTICIPANT_HAS_TAG', { currentLabel: 'B-0012' })).toMatchObject({ tone: 'amber', icon: '!', headline: 'Ada Lovelace already has B-0012', action: 'replace-badge', dismiss: 'tap' });
    expect(link('TAG_RETIRED')).toMatchObject({ tone: 'red', headline: 'Deactivated badge', detail: 'Pick another badge' });
    expect(link('TAG_NOT_FOUND')).toMatchObject({ tone: 'red', headline: 'Not registered for this event' });
    expect(link('TAG_WRONG_EVENT')).toMatchObject({ tone: 'red', headline: 'Not registered for this event' });
    expect(viewFor({ kind: 'not_our_badge' }, ctx())).toMatchObject({ tone: 'amber', icon: '?', headline: 'Not a Passline badge', dismiss: { autoMs: 1500 } });
  });

  it('I-1 (extended): green only for ACCEPTED, ASSIGNED and ALREADY_ASSIGNED', () => {
    for (const code of ['REPEAT_SERVING', 'TAG_UNASSIGNED', 'TAG_REPLACED'] as const) expect(viewFor(server({ code, participant }), ctx('meal')).tone, code).not.toBe('green');
    for (const code of LINK_CODES) {
      const tone = viewFor({ kind: 'link', code, badgeLabel: 'B-1', personName: 'Ada' }, ctx()).tone;
      expect(tone === 'green', code).toBe(code === 'ASSIGNED' || code === 'ALREADY_ASSIGNED');
    }
    expect(viewFor({ kind: 'not_our_badge' }, ctx()).tone).not.toBe('green');
  });

  it('PLAN §10.2 (V5a): meal servings, points, REPEAT_SERVING and badge problems', () => {
    expect(viewFor(server({ code: 'ACCEPTED', participant, servingNo: 2 }), ctx('meal'))).toMatchObject({ tone: 'green', headline: 'SERVE (2nd serving)' });
    expect(viewFor(server({ code: 'ACCEPTED', participant, servingNo: 3 }), ctx('meal')).headline).toBe('SERVE (3rd serving)');
    expect(viewFor(server({ code: 'ACCEPTED', participant, servingNo: 1 }), ctx('meal')).headline).toBe('SERVE');
    expect(viewFor(server({ code: 'ACCEPTED', participant, points: 10 }), ctx('session'))).toMatchObject({ tone: 'green', headline: 'RECORDED · +10 pts' });
    expect(viewFor(server({ code: 'ACCEPTED', participant, points: 0 }), ctx('custom')).headline).toBe('RECORDED');
    const at = new Date(now.getTime() - 120_000).toISOString();
    expect(viewFor(server({ code: 'REPEAT_SERVING', participant, servedCount: 1, previous: { scannedAt: at, scannedByName: 'Maya', scannedByMe: false } }), ctx('meal'))).toMatchObject({
      tone: 'amber',
      icon: '⟳',
      headline: 'SERVED 1× ALREADY',
      detail: 'Last 12:01 PM by Maya',
      name: 'Ada Lovelace',
      photoUrl: 'https://x/p.jpg',
      action: 'serve-again',
      dismiss: 'tap',
    });
    expect(viewFor(server({ code: 'TAG_UNASSIGNED', tagLabel: 'B-0005' }), ctx('door'))).toMatchObject({ tone: 'amber', headline: 'BADGE NOT LINKED (B-0005)', detail: 'Scan their pass first, then link the badge' });
    expect(viewFor(server({ code: 'TAG_UNASSIGNED', tagLabel: 'B-0005' }), ctx('meal'))).toMatchObject({ tone: 'amber', detail: 'Send them to the door' });
    expect(viewFor(server({ code: 'TAG_REPLACED', participant, retiredAt: at }), ctx('meal'))).toMatchObject({ tone: 'red', icon: '✕', headline: 'OLD BADGE · replaced 12:01 PM', name: 'Ada Lovelace' });
  });
});
