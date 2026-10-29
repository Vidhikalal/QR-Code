import { env } from '@/lib/env';
import { BadgeWriter } from './writer';

// SPEC §11 Tools page (organizer only, enforced by the admin layout; the tab shows only where Web NFC exists).
export default function ToolsPage() {
  const { BADGE_ORIGIN, NEXT_PUBLIC_APP_ORIGIN } = env();
  return (
    <>
      <h1>Tools</h1>
      <BadgeWriter origin={BADGE_ORIGIN ?? NEXT_PUBLIC_APP_ORIGIN} />
    </>
  );
}
