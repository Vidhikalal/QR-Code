import { participantRoute } from '@/lib/participant/server';

// PLAN §9.2: check-in photo via the participant session (same pipeline as /api/pass/photo).
export const POST = participantRoute('uploadPhoto');
