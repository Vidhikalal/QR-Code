import { Leaderboard } from './leaderboard';

// SPEC F16 step 6 (v0.12): the connection leaderboard for the projector (organizers; the layout checks the role).
export default async function LeaderboardPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  return <Leaderboard slug={slug} />;
}
