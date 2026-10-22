import { describe, expect, it } from 'vitest';
import { generateToken, passToken, sha256hex } from '@/lib/domain/token';

describe('tokens', () => {
  it('T-TOK-01: 10,000 generated tokens are unique, 32 chars, url-safe', () => {
    const tokens = Array.from({ length: 10_000 }, () => generateToken());
    expect(new Set(tokens).size).toBe(10_000);
    for (const t of tokens) expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });

  it('T-TOK-06: sha256hex matches the known "abc" vector', () => {
    expect(sha256hex('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('T-TOK-10: passToken is deterministic, 32 url-safe chars, and changes with the pass id or the secret', () => {
    const secret = 'x'.repeat(32);
    const id = '6f1c2a5e-8a4b-4d5e-9f00-1234567890ab';
    const t = passToken(secret, id);
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(passToken(secret, id)).toBe(t);
    expect(passToken(secret, '6f1c2a5e-8a4b-4d5e-9f00-1234567890ac')).not.toBe(t);
    expect(passToken('y'.repeat(32), id)).not.toBe(t);
  });
});
