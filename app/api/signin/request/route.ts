import { participantRoute } from '@/lib/participant/server';

// PLAN F18 "Email me a link": always the same answer.
export const POST = participantRoute('requestLink');
