import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTagsApi } from '@/lib/tags/handlers';
import { serviceClient } from '../fixtures/mail';
import { ME_ORIGIN } from '../fixtures/participant-api';
import { asBearer, bearerAuth, signInAs } from '../fixtures/staff';
import { createStandardFixture, type Badges, type StandardFixture } from '../fixtures/standard';

// Door (PLAN F20, user decision 2026-10-10): scan the pass → tap a BLANK badge → it is registered and
// linked in one step. Volunteers may register through this path only (register_tag stays organizer-only).
let f: StandardFixture;
let b: Badges;
let volJwt: string;
let vol3Jwt: string;
const api = createTagsApi({ db: serviceClient(), authenticate: bearerAuth, meOrigin: ME_ORIGIN });

beforeAll(async () => {
  f = await createStandardFixture({ poolSize: 4 });
  b = await f.addBadges();
  [volJwt, vol3Jwt] = await Promise.all([signInAs(f.staffEmail.vol1), signInAs(f.staffEmail.vol3)]);
});
afterAll(async () => {
  await f.close();
});

type R = { code: string; label?: string; [k: string]: unknown };
const sql = async (q: string, params: unknown[]) => (await f.pool.query<{ r: R }>(q, params)).rows[0]?.r as R;
const freshId = () => randomBytes(9).toString('base64url');
const freshUid = () => `04${randomBytes(6).toString('hex').toUpperCase()}`;
const reserve = (staff: string, who: string, publicId = freshId(), event = f.e1.id) =>
  sql('select reserve_door_tag($1, $2, $3, $4) as r', [event, staff, who, publicId]).then((r) => ({ ...r, publicId }));
const link = (staff: string, who: string, publicId: string, uid: string | null, replace = false) =>
  sql('select door_link_new_tag($1, $2, $3, $4, $5, $6) as r', [f.e1.id, staff, who, publicId, uid, replace]);
const admitted = async () => {
  const n = await f.addParticipant(f.e1.id);
  await f.checkIn(n.id);
  return n.id;
};
const tagRow = async (publicId: string) =>
  (await f.pool.query<{ uid: string | null; label: string; retired_at: Date | null }>('select uid, label, retired_at from tags where public_id = $1', [publicId])).rows[0];

describe('reserve_door_tag', () => {
  it('a volunteer reserves the next label for someone admitted at the door', async () => {
    const who = await admitted();
    const r = await reserve(f.staff.vol1, who);
    expect(r).toMatchObject({ code: 'RESERVED', label: expect.stringMatching(/^B-\d{4}$/) });
    expect(await tagRow(r.publicId)).toMatchObject({ uid: null, label: r.label });
  });

  it('refuses someone not checked in, another event’s staff, and an unknown person', async () => {
    const notIn = await f.addParticipant(f.e1.id);
    expect((await reserve(f.staff.vol1, notIn.id)).code).toBe('NOT_CHECKED_IN');
    expect((await reserve(f.staff.vol3, await admitted())).code).toBe('FORBIDDEN');
    expect((await reserve(f.staff.vol1, f.p.X)).code).toBe('NOT_FOUND'); // X is in E2
  });
});

describe('door_link_new_tag', () => {
  it('confirms the serial and links in one step; a replay is ALREADY_ASSIGNED', async () => {
    const who = await admitted();
    const r = await reserve(f.staff.vol1, who);
    const uid = freshUid();
    expect(await link(f.staff.vol1, who, r.publicId, uid)).toMatchObject({ code: 'ASSIGNED', registered: true });
    expect((await tagRow(r.publicId))?.uid).toBe(uid);
    const { rows } = await f.pool.query('select 1 from tag_assignments t join tags g on g.id = t.tag_id where g.public_id = $1 and t.participant_id = $2 and t.ended_at is null', [r.publicId, who]);
    expect(rows).toHaveLength(1);
    expect((await link(f.staff.vol1, who, r.publicId, uid)).code).toBe('ALREADY_ASSIGNED');
  });

  it('only the staff member who reserved it can confirm it; a used serial is UID_CONFLICT', async () => {
    const who = await admitted();
    const r = await reserve(f.staff.vol1, who);
    expect((await link(f.staff.vol2, who, r.publicId, freshUid())).code).toBe('NOT_RESERVED');
    expect((await link(f.staff.vol1, who, r.publicId, b.tag.T4.uid)).code).toBe('UID_CONFLICT'); // T4's chip
    expect((await tagRow(r.publicId))?.uid).toBeNull();
  });

  it('works without a serial (phone gave none): the badge is identified by its URL', async () => {
    const who = await admitted();
    const r = await reserve(f.staff.vol1, who);
    expect((await link(f.staff.vol1, who, r.publicId, null)).code).toBe('ASSIGNED');
  });

  it('a person who already wears a badge → PARTICIPANT_HAS_TAG, the new badge stays registered; replace links it and retires the old one', async () => {
    const who = await admitted();
    const first = await reserve(f.staff.vol1, who);
    await link(f.staff.vol1, who, first.publicId, freshUid());
    const second = await reserve(f.staff.vol1, who);
    const uid = freshUid();
    expect((await link(f.staff.vol1, who, second.publicId, uid)).code).toBe('PARTICIPANT_HAS_TAG');
    expect((await tagRow(second.publicId))?.uid).toBe(uid);
    expect((await link(f.staff.vol1, who, second.publicId, uid, true)).code).toBe('ASSIGNED');
    expect((await tagRow(first.publicId))?.retired_at).not.toBeNull();
  });

  it('register_tag (the Register page) is still organizer-only (T-TAG-11)', async () => {
    expect((await f.pool.query<{ r: string }>('select register_tag($1, $2, $3, $4) as r', [f.e1.id, f.staff.vol1, freshId(), null])).rows[0]?.r).toBe('FORBIDDEN');
  });
});

describe('door badge API', () => {
  const post = (handler: 'doorReserve' | 'doorLink', jwt: string | null, body: unknown) =>
    api[handler](new Request('http://localhost/api/tags/x', { method: 'POST', headers: { 'content-type': 'application/json', ...asBearer(jwt) }, body: JSON.stringify(body) }));

  it('reserve → write (phone) → link, as a volunteer; signed out 401; another event’s staff 403', async () => {
    const who = await admitted();
    const res = await post('doorReserve', volJwt, { eventSlug: f.slug, participantId: who });
    expect(res.status).toBe(200);
    const r = (await res.json()) as { code: string; publicId: string; label: string; url: string };
    expect(r).toMatchObject({ code: 'RESERVED', url: `${ME_ORIGIN}/t/${r.publicId}` });
    const linked = await post('doorLink', volJwt, { eventSlug: f.slug, participantId: who, tagPublicId: r.publicId, tagUid: (freshUid().match(/../g) ?? []).join(':').toLowerCase() }); // Web NFC's format
    expect(await linked.json()).toMatchObject({ code: 'ASSIGNED', tagLabel: r.label, assignmentId: expect.any(String) });
    expect((await post('doorReserve', null, { eventSlug: f.slug, participantId: who })).status).toBe(401);
    expect((await post('doorReserve', vol3Jwt, { eventSlug: f.slug, participantId: who })).status).toBe(403);
    expect((await post('doorLink', volJwt, { eventSlug: f.slug, participantId: who, tagPublicId: 'bad' })).status).toBe(400);
  });
});
