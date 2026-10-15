import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { generateSecret, sha256hex } from '@/lib/domain/token';
import { ingestClient, sheetRow } from '../fixtures/ingest';
import { participantClient } from '../fixtures/participant-api';
import { createStandardFixture, type StandardFixture } from '../fixtures/standard';

// Profiles part B: the form's "What are you good at?", "What are you looking for?" and "Accessibility
// or health needs" flow into the profile. Once the owner edits a field, re-syncs no longer overwrite it.
let f: StandardFixture;
const c = ingestClient();
const me = participantClient();

beforeAll(async () => {
  f = await createStandardFixture();
});
afterAll(async () => {
  await f.close();
});

type State = { id: string; dietary_notes: string | null; accessibility_notes: string | null; skills: string[] | null; looking_for: string[] | null; linkedin: string | null; year: string | null };
async function state(externalId: string): Promise<State | undefined> {
  const { rows } = await f.pool.query<State>(
    `select p.id, p.dietary_notes, p.accessibility_notes, pr.ask_me_about as skills, pr.looking_for, pr.linkedin_url as linkedin, pr.year_label as year
       from participants p left join profiles pr on pr.participant_id = p.id
      where p.event_id = $1 and p.external_id = $2`,
    [f.e1.id, externalId],
  );
  return rows[0];
}

const answers = { skills: 'Frontend, UI/UX design', looking_for: 'A team, Networking', accessibility_notes: 'Step-free access', dietary_notes: 'Vegan', linkedin_url: 'https://www.linkedin.com/in/ada-l' };

describe('form answers → profile (profiles part B)', () => {
  it('a new accepted row carries the answers into the participant and a new profile; the same request again is UNCHANGED', async () => {
    const row = sheetRow(f.slug, answers);
    expect(await c.ingest(f.slug, [row])).toEqual(['PASS_QUEUED']);
    expect(await state(row.external_id ?? '')).toMatchObject({
      dietary_notes: 'Vegan',
      accessibility_notes: 'Step-free access',
      skills: ['Frontend', 'UI/UX design'],
      looking_for: ['team', 'networking'],
      linkedin: 'https://www.linkedin.com/in/ada-l', // seeded like issue_profile_key does
    });
    expect(await c.ingest(f.slug, [row])).toEqual(['UNCHANGED']);
  });

  it('a corrected answer in the Sheet is UPDATED and flows through while the owner hasn\'t touched it', async () => {
    const row = sheetRow(f.slug, answers);
    await c.ingest(f.slug, [row]);
    expect(await c.ingest(f.slug, [{ ...row, skills: 'Rust', accessibility_notes: '' }])).toEqual(['UPDATED']);
    expect(await state(row.external_id ?? '')).toMatchObject({ skills: ['Rust'], accessibility_notes: null });
  });

  it('after the owner edits skills and dietary notes in their profile, re-syncs keep their version; untouched fields still follow the Sheet', async () => {
    const row = sheetRow(f.slug, answers);
    await c.ingest(f.slug, [row]);
    const s = await state(row.external_id ?? '');
    const key = generateSecret();
    await f.pool.query('select issue_profile_key($1, $2)', [s?.id, sha256hex(key)]);
    const cookie = await me.signIn(key);
    const edit = await me.call('updateProfile', { method: 'PATCH', cookie, body: { skills: ['Go'], dietaryNotes: 'Vegetarian' } });
    expect(edit.status).toBe(200);

    // Same answers as before for the edited fields: nothing changes and the row is UNCHANGED.
    expect(await c.ingest(f.slug, [row])).toEqual(['UNCHANGED']);
    // Different answers: the owner's skills/dietary win; accessibility and looking-for follow the Sheet.
    expect(await c.ingest(f.slug, [{ ...row, skills: 'Python', dietary_notes: 'Halal', accessibility_notes: 'Quiet room', looking_for: 'A job' }])).toEqual(['UPDATED']);
    expect(await state(row.external_id ?? '')).toMatchObject({ skills: ['Go'], dietary_notes: 'Vegetarian', accessibility_notes: 'Quiet room', looking_for: ['job'] });
  });

  it('Demo feedback 2026-10-14: the form\'s Year of study and checkbox skills seed the profile (top 3); the owner\'s Year wins on re-sync', async () => {
    const row = sheetRow(f.slug, { skills: 'Frontend, Backend, Mobile apps, Databases', year_label: '2nd year' });
    expect(await c.ingest(f.slug, [row])).toEqual(['PASS_QUEUED']);
    expect(await state(row.external_id ?? '')).toMatchObject({ skills: ['Frontend', 'Backend', 'Mobile apps'], year: '2nd year' });
    // A Sheet correction flows through until the owner edits it.
    expect(await c.ingest(f.slug, [{ ...row, year_label: '3rd year' }])).toEqual(['UPDATED']);
    expect(await state(row.external_id ?? '')).toMatchObject({ year: '3rd year' });
    // A year that isn't an option is dropped (the profile keeps what it had), never INVALID.
    expect(await c.ingest(f.slug, [{ ...row, year_label: 'Senior' }])).toEqual(['UNCHANGED']);

    const s = await state(row.external_id ?? '');
    const key = generateSecret();
    await f.pool.query('select issue_profile_key($1, $2)', [s?.id, sha256hex(key)]);
    const cookie = await me.signIn(key);
    expect((await me.call('updateProfile', { method: 'PATCH', cookie, body: { yearLabel: 'Alumni' } })).status).toBe(200);
    expect(await c.ingest(f.slug, [{ ...row, year_label: '4th year' }])).toEqual(['UNCHANGED']);
    expect(await state(row.external_id ?? '')).toMatchObject({ year: 'Alumni' });
  });

  it('Demo feedback 2026-10-14: a form answer with only a Year still creates the profile', async () => {
    const row = sheetRow(f.slug, { year_label: '1st year' });
    expect(await c.ingest(f.slug, [row])).toEqual(['PASS_QUEUED']);
    expect(await state(row.external_id ?? '')).toMatchObject({ year: '1st year', skills: [] });
  });

  it('a dry run (Sync now preview) writes nothing, profiles included', async () => {
    const row = sheetRow(f.slug, answers);
    await c.ingest(f.slug, [row]);
    const before = await state(row.external_id ?? '');
    const { rows } = await f.pool.query<{ r: string }>(
      `select ingest_sheet_row($1, $2, $3, 'Ada', '', 'ada', 'accepted', 'Vegan', null, true, 'Quiet room', array['Python'], array['job']) as r`,
      [f.e1.id, row.external_id, row.email],
    );
    expect(rows[0]?.r).toBe('UPDATED');
    expect(await state(row.external_id ?? '')).toEqual(before);
  });

  it('old Sheets without the new columns keep working (no fields → nothing new written)', async () => {
    const row = sheetRow(f.slug);
    expect(await c.ingest(f.slug, [row])).toEqual(['PASS_QUEUED']);
    expect(await state(row.external_id ?? '')).toMatchObject({ accessibility_notes: null, skills: null, looking_for: null });
  });
});
