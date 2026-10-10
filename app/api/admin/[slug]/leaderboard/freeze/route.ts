import { leaderboardRoute } from '@/lib/leaderboard/server';

// PLAN F25: freeze or unfreeze both boards.
export const POST = leaderboardRoute('freeze');
