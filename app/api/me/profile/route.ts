import { participantRoute } from '@/lib/participant/server';

// PLAN §10.4: the /me profile form.
export const GET = participantRoute('getProfile');
export const PATCH = participantRoute('updateProfile');
