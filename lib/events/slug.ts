import { z } from 'zod';

// Route names a slug would shadow: /admin/new (page) and /api/admin/events (API). The events table
// has the same check (events_slug_not_reserved); this copy gives a friendly 400.
export const RESERVED_SLUGS = ['new', 'events'] as const;

export const eventSlugSchema = z
  .string()
  .regex(/^[a-z0-9-]{3,40}$/)
  .refine((s) => !(RESERVED_SLUGS as readonly string[]).includes(s), 'reserved');

// "Hack Day 2026!" → "hack-day-2026". Only a suggestion: the organizer can edit it.
export function suggestSlug(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .slice(0, 40)
    .replace(/^-+|-+$/g, '');
}
