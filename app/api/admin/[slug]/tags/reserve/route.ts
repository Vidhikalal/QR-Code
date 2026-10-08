import { tagsRoute } from '@/lib/tags/server';

// PLAN F19 A: the server mints the badge id before the phone writes it.
export const POST = tagsRoute('reserve');
