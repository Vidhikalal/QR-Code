import { describe, expect, it } from 'vitest';
import { parseProfileInput } from '@/lib/domain/profile';

const contact = { emergencyName: 'Sam Lee', emergencyPhone: '+1 (416) 555-0100', emergencyRelation: 'Parent' };

describe('parseProfileInput (SPEC F13/F14, v0.6)', () => {
  it('T-ME-04: trims and normalizes; missing fields stay unchanged, blank ones clear', () => {
    expect(parseProfileInput({}, { requireEmergency: false })).toEqual({ ok: true, value: {} });
    expect(
      parseProfileInput(
        {
          linkedin: ' linkedin.com/in/ada-l ',
          profilePublic: true,
          dietaryNotes: ' Vegan ',
          emergencyName: ' Sam Lee ',
          emergencyPhone: ' 416.555.0100 ',
          emergencyRelation: '  ',
        },
        { requireEmergency: true },
      ),
    ).toEqual({
      ok: true,
      value: {
        linkedinUrl: 'https://www.linkedin.com/in/ada-l',
        profilePublic: true,
        dietaryNotes: 'Vegan',
        emergency: { name: 'Sam Lee', phone: '416.555.0100', relation: '' },
      },
    });
    expect(parseProfileInput({ linkedin: '  ', dietaryNotes: '' }, { requireEmergency: false })).toEqual({
      ok: true,
      value: { linkedinUrl: '', dietaryNotes: '' },
    });
    expect(parseProfileInput({ ...contact, emergencyName: 'n'.repeat(100), dietaryNotes: 'd'.repeat(500) }, { requireEmergency: false })).toMatchObject({
      ok: true,
    });
  });

  it('T-ME-04: names the first invalid field and never throws', () => {
    const bad: Array<[Parameters<typeof parseProfileInput>[0], string]> = [
      [{ linkedin: 'linkedin.com/company/x' }, 'linkedin'],
      [{ dietaryNotes: 'd'.repeat(501) }, 'dietaryNotes'],
      [{ ...contact, emergencyName: '  ' }, 'emergencyName'],
      [{ ...contact, emergencyName: 'n'.repeat(101) }, 'emergencyName'],
      [{ ...contact, emergencyPhone: 'abc' }, 'emergencyPhone'],
      [{ ...contact, emergencyPhone: '12' }, 'emergencyPhone'],
      [{ ...contact, emergencyPhone: '+() --' }, 'emergencyPhone'],
      [{ ...contact, emergencyPhone: '1'.repeat(31) }, 'emergencyPhone'],
      [{ emergencyName: 'Sam Lee' }, 'emergencyPhone'],
      [{ ...contact, emergencyRelation: 'r'.repeat(61) }, 'emergencyRelation'],
    ];
    for (const [input, field] of bad) {
      expect(parseProfileInput(input, { requireEmergency: false }), JSON.stringify(input)).toEqual({ ok: false, field });
    }
    // The RSVP Yes form requires the emergency contact.
    expect(parseProfileInput({ linkedin: '' }, { requireEmergency: true })).toEqual({ ok: false, field: 'emergencyName' });
    expect(parseProfileInput(contact, { requireEmergency: true })).toMatchObject({ ok: true });
  });
});
