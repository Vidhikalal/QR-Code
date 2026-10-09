import { participantRoute } from '@/lib/participant/server';

// PLAN F24: Connect, and "My connections".
export const GET = participantRoute('listConnections');
export const POST = participantRoute('connect');
