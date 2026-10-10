import { adminRoute } from '@/lib/admin/server';

// PLAN F26.2: queue recaps for everyone who checked in.
export const POST = adminRoute('recapSend');
