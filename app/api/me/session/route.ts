import { participantRoute } from '@/lib/participant/server';

// PLAN F17/F18: open a session from an edit key; sign out this device.
export const POST = participantRoute('openSession');
export const DELETE = participantRoute('endSession');
