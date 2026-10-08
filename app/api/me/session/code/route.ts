import { participantRoute } from '@/lib/participant/server';

// PLAN F18: redeem a 2-minute sign-in code.
export const POST = participantRoute('redeemCode');
