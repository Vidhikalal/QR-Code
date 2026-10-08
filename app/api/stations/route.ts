import { tagsRoute } from '@/lib/tags/server';

// PLAN §6.6: the checkpoint this staff member is working, read by the badge page.
export const POST = tagsRoute('setStation');
