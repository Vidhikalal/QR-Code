import { expect, it } from 'vitest';
import { parseProfileInput } from '@/lib/domain/profile';

it('T-DIR-01: directory fields preserve missing, clear blank, keep plain text/newlines and validate pace and bio', () => {
  const parse = (raw: Parameters<typeof parseProfileInput>[0]) => parseProfileInput(raw, { requireEmergency: false });
  expect(parse({})).toEqual({ ok: true, value: {} });
  expect(parse({ directoryOptIn: false, bio: ' \r\n ', pace: ' ' })).toEqual({ ok: true, value: { directoryOptIn: false, bio: '', pace: '' } });
  expect(parse({ directoryOptIn: true, bio: ' <b>Hello</b>\r\nworld ', pace: 'balanced' })).toEqual({ ok: true, value: { directoryOptIn: true, bio: '<b>Hello</b>\nworld', pace: 'balanced' } });
  for (const pace of ['competitive', 'balanced', 'casual']) expect(parse({ pace })).toMatchObject({ ok: true, value: { pace } });
  expect(parse({ pace: 'fast' })).toEqual({ ok: false, field: 'pace' });
  expect(parse({ bio: 'x'.repeat(280) })).toMatchObject({ ok: true });
  expect(parse({ bio: 'x'.repeat(281) })).toEqual({ ok: false, field: 'bio' });
});
