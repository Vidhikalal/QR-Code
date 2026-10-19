import { describe, expect, it } from 'vitest';
import { isAdminEmail } from '@/lib/auth/admins';

describe('admin emails (SPEC F9, v0.4.1)', () => {
  it('T-AUTH-06: isAdminEmail matches normalized addresses only', () => {
    expect(isAdminEmail(' Yves@X.com ', ['yves@x.com'])).toBe(true);
    expect(isAdminEmail('other@x.com', ['yves@x.com'])).toBe(false);
    expect(isAdminEmail('yves@x.com', [])).toBe(false);
    expect(isAdminEmail(null, ['yves@x.com'])).toBe(false);
    expect(isAdminEmail('', [''])).toBe(false);
  });
});
