import { env } from '@/lib/env';
import { BadgeWriter } from './writer';

// SPEC §11 Badges page (organizer only, enforced by the admin layout).
export default function BadgesPage() {
  const { BADGE_ORIGIN, NEXT_PUBLIC_APP_ORIGIN } = env();
  return <BadgeWriter origin={BADGE_ORIGIN ?? NEXT_PUBLIC_APP_ORIGIN} />;
}
