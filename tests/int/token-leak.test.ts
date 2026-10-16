import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { sha256hex } from '@/lib/domain/token';
import { ingestClient, sheetRow } from '../fixtures/ingest';
import { onlyEmailTo, rsvpTokenFromEmail, sentTo, tokenFromEmail } from '../fixtures/mail';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

let f: StandardFixture;
beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

describe('token secrecy (I-3)', () => {
  it('T-TOK-07: after ingest → RSVP → Yes → pass email → scan, neither raw token appears in any text/json column of any public table', async () => {
    const c = ingestClient();
    const row = sheetRow(f.slug);
    expect(await c.ingest(f.slug, [row])).toEqual(['CREATED']);
    const { rows: me } = await f.pool.query<{ id: string }>('select id from participants where event_id = $1 and external_id = $2', [f.e1.id, row.external_id]);
    await f.pool.query('select queue_rsvps($1, $2, $3)', [f.e1.id, [me[0]?.id], f.staff.org1]);
    await c.drain(); // drains every due row, so pick out the email addressed to this participant
    const rsvpToken = rsvpTokenFromEmail(onlyEmailTo(c.mail.sent, row.email));
    await f.pool.query('select rsvp_respond($1, true)', [sha256hex(rsvpToken)]);
    await c.drain();
    const passEmails = sentTo(c.mail.sent, row.email).filter((m) => m.text.includes('/p#'));
    const token = tokenFromEmail(onlyEmailTo(passEmails, row.email));
    expect((await f.scan({ cp: f.cp.D, staff: f.staff.vol1, token })).code).toBe('ACCEPTED');

    const { rows: cols } = await f.pool.query<{ table_name: string; column_name: string }>(
      `select table_name, column_name from information_schema.columns
        where table_schema = 'public' and data_type in ('text', 'character varying', 'jsonb', 'json', 'ARRAY', 'USER-DEFINED')`,
    );
    expect(cols.length).toBeGreaterThan(10);
    const hits: string[] = [];
    for (const c of cols) {
      for (const secret of [token, rsvpToken]) {
        const { rows } = await f.pool.query<{ n: number }>(
          `select count(*)::int as n from public.${JSON.stringify(c.table_name)} where ${JSON.stringify(c.column_name)}::text like '%' || $1 || '%'`,
          [secret],
        );
        if ((rows[0]?.n ?? 0) > 0) hits.push(`${c.table_name}.${c.column_name}`);
      }
    }
    expect(hits).toEqual([]);
  });
});
