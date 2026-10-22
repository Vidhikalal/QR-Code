import { adminRoute } from '@/lib/admin/server';

export const GET = adminRoute('getParticipant');
export const PATCH = adminRoute('setParticipantTeam');
export const DELETE = adminRoute('deleteParticipant');
