import { randomUUID } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { passToken, sha256hex } from '@/lib/domain/token';
import { myBadgeProfiles, saveBadgeProfile } from '@/lib/me/profile';
import { myPasses } from '@/lib/pass/mine';
import { serviceClient } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
const secret = 'test-secret-for-my-passes-000000000000';
beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

const emailOf = async (id: string) =>
  (await f.pool.query<{ email: string }>('select email from participants where id = $1', [id])).rows[0]?.email ?? '';
const mine = (email: string) => myPasses(serviceClient(), email, secret, new Date());

describe('/me (SPEC §6.1, v0.4)', () => {
  it('T-ME-01: shows only your own accepted passes, with a token that matches the stored hash', async () => {
    const a = await emailOf(f.p.A);
    // A's fixture pass has a random token (as before v0.4): it can't be shown again.
    expect((await mine(a)).map((p) => p.pass)).toEqual(['in_email']);

    const passId = randomUUID();
    const token = passToken(secret, passId);
    await f.pool.query('select issue_pass($1, $2, $3)', [f.p.A, sha256hex(token), passId]);
    const [only, ...rest] = await mine(` ${a.toUpperCase()} `);
    expect(rest).toEqual([]);
    expect(only).toMatchObject({ participantId: f.p.A, pass: { token } });
    expect(only?.event.name).toBeTruthy();

    // Accepted but not issued yet (an RSVP Yes waiting on the outbox): "on its way".
    await f.pool.query(`update passes set revoked_at = now(), revoke_reason = 'manual' where participant_id = $1`, [f.p.A]);
    expect((await mine(a)).map((p) => p.pass)).toEqual(['on_its_way']);

    // Waitlisted, withdrawn, deleted, another event's past: nothing.
    expect(await mine(await emailOf(f.p.C))).toEqual([]);
    expect(await mine(await emailOf(f.p.Wd))).toEqual([]);
    await f.pool.query(`update events set starts_at = now() - interval '2 days', ends_at = now() - interval '1 day' where id = $1`, [f.e2.id]);
    expect(await mine(await emailOf(f.p.X))).toEqual([]);
  });
});

describe('/me badge profile (SPEC §6.5, v0.5)', () => {
  const row = async (id: string) =>
    (
      await f.pool.query<{ linkedin_url: string | null; profile_public: boolean; own: boolean }>(
        'select linkedin_url, profile_public, linkedin_set_at is not null as own from participants where id = $1',
        [id],
      )
    ).rows[0];

  it('T-ME-03: an attendee sets their own LinkedIn and sharing; invalid input and other people’s rows change nothing', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const user = { id: f.staff.vol1, email: (await emailOf(id)).toUpperCase() };
    const save = (participantId: string, linkedin: string, profilePublic: boolean) =>
      saveBadgeProfile(serviceClient(), user, participantId, { linkedin, profilePublic });

    expect(await save(id, 'linkedin.com/in/ada-l', true)).toBe('SAVED');
    expect(await row(id)).toEqual({ linkedin_url: 'https://www.linkedin.com/in/ada-l', profile_public: true, own: true });
    expect(await save(id, 'linkedin.com/company/x', false)).toBe('INVALID_LINKEDIN');
    expect(await row(id)).toEqual({ linkedin_url: 'https://www.linkedin.com/in/ada-l', profile_public: true, own: true });
    expect(await save(id, '  ', false)).toBe('SAVED');
    expect(await row(id)).toEqual({ linkedin_url: null, profile_public: false, own: true });

    const before = await row(f.p.B);
    expect(await save(f.p.B, 'linkedin.com/in/hijack', true)).toBe('NOT_FOUND');
    expect(await save('not-a-uuid', 'linkedin.com/in/hijack', true)).toBe('NOT_FOUND');
    expect(await row(f.p.B)).toEqual(before);

    const { rows } = await f.pool.query<{ actor_kind: string; detail: unknown }>(
      `select actor_kind, detail from audit_log where action = 'profile.update' and subject_id = $1`,
      [id],
    );
    expect(rows.map((r) => r.actor_kind)).toEqual(['participant', 'participant']);
    expect(JSON.stringify(rows)).not.toMatch(/linkedin|ada|@/i); // ids and the on/off flag only (I-11)
  });

  it('T-ME-03: lists your accepted events up to 30 days after they end, and whether a badge is linked', async () => {
    const { id } = await f.addParticipant(f.e1.id);
    const email = await emailOf(id);
    const mineNow = () => myBadgeProfiles(serviceClient(), email, new Date());
    expect(await mineNow()).toEqual([
      { participantId: id, eventId: f.e1.id, eventName: f.e1.name, linkedinUrl: null, profilePublic: false, badge: false },
    ]);
    await f.linkBadge(id);
    expect(await mineNow()).toMatchObject([{ participantId: id, badge: true }]);
    expect(await myBadgeProfiles(serviceClient(), await emailOf(f.p.C), new Date())).toEqual([]);
    const in31Days = new Date(Date.now() + 32 * 24 * 3600 * 1000); // e1 ends within a day
    expect(await myBadgeProfiles(serviceClient(), email, in31Days)).toEqual([]);
  });
});
