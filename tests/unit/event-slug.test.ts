import { describe, expect, it } from 'vitest';
import { eventSlugSchema, suggestSlug } from '@/lib/events/slug';

describe('event slugs (PLAN F14)', () => {
  it('V1: suggestSlug lowercases, strips accents and punctuation, and joins words with hyphens', () => {
    expect(suggestSlug('Hack Day 2026!')).toBe('hack-day-2026');
    expect(suggestSlug('  Café   Night — Été ')).toBe('cafe-night-ete');
    expect(suggestSlug("O'Brien's Mixer")).toBe('o-brien-s-mixer');
  });

  it('V1: suggestSlug caps at 40 chars without a trailing hyphen, and returns "" when nothing usable is left', () => {
    const s = suggestSlug('a'.repeat(39) + ' bcd');
    expect(s.length).toBeLessThanOrEqual(40);
    expect(s.endsWith('-')).toBe(false);
    expect(suggestSlug('!!!')).toBe('');
    expect(suggestSlug('李雷')).toBe('');
  });

  it('V1: eventSlugSchema mirrors the DB check and rejects reserved route names', () => {
    for (const ok of ['abc', 'hack-day-2026', 'a'.repeat(40)]) expect(eventSlugSchema.safeParse(ok).success, ok).toBe(true);
    for (const bad of ['ab', 'a'.repeat(41), 'Hack', 'has space', 'new', 'events']) {
      expect(eventSlugSchema.safeParse(bad).success, bad).toBe(false);
    }
  });
});
