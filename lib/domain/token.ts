import { createHash, createHmac, randomBytes } from 'node:crypto';

// Random tokens (tests and the seed script). SPEC §6.1: 24 random bytes → 32 base64url chars, 192 bits of entropy.
export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

// SPEC §6.1 (v0.4): a pass's token is derived from its id, so the signed-in owner can see it again on
// /me without it ever being stored. Same shape as generateToken(): 24 bytes → 32 base64url chars.
export function passToken(secret: string, passId: string): string {
  return createHmac('sha256', secret).update(passId, 'utf8').digest().subarray(0, 24).toString('base64url');
}

// Lowercase hex sha256; the only form of a token that is ever stored (I-3).
export function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
