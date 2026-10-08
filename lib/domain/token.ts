import { createHash, randomBytes } from 'node:crypto';

// SPEC §6.1: 24 random bytes → 32 base64url chars, 192 bits of entropy.
export function generateToken(): string {
  return randomBytes(24).toString('base64url');
}

// PLAN §5.2 / D8: edit keys and session values. 32 random bytes → 43 base64url chars, 256 bits.
// A different secret from the pass token: the QR is shown at the door and screenshotted.
export function generateSecret(): string {
  return randomBytes(32).toString('base64url');
}

// Lowercase hex sha256; the only form of a token that is ever stored (I-3).
export function sha256hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
