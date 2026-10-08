import { randomBytes } from 'node:crypto';

// PLAN D3: a badge's public id is 9 random bytes → 12 base64url chars (72 bits). An identifier,
// never a credential (I-16). Server only.
export function mintPublicId(): string {
  return randomBytes(9).toString('base64url');
}
