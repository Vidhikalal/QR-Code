import { env } from '@/lib/env';
import { Participants } from './participants';

export default async function ParticipantsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { BADGE_ORIGIN, NEXT_PUBLIC_APP_ORIGIN } = env();
  return <Participants slug={slug} badgeOrigin={BADGE_ORIGIN ?? NEXT_PUBLIC_APP_ORIGIN} />;
}
