import { adminRoute } from '@/lib/admin/server';

export const GET = adminRoute('getSettings');
export const PATCH = adminRoute('updateSettings');
