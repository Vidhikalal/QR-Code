import { adminRoute } from '@/lib/admin/server';

// PLAN §6.3 abuse switch. Served on both hosts (I-23) for the badge page's staff panel (V4).
export const POST = adminRoute('hideProfile');
