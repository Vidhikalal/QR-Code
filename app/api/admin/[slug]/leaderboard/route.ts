import { leaderboardRoute } from '@/lib/leaderboard/server';

// PLAN F25: one board as of the projector's time (organizer only).
export const GET = leaderboardRoute('get');
