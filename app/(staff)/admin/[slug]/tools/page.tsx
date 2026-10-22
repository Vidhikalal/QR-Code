import { env } from '@/lib/env';
import { BadgeLinker } from './linker';
import { BadgeWriter } from './writer';

// SPEC §11 Tools page (organizer only, enforced by the admin layout; the tab shows only where Web NFC exists).
export default async function ToolsPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { BADGE_ORIGIN, NEXT_PUBLIC_APP_ORIGIN } = env();
  return (
    <>
      <h1>Tools</h1>
      <BadgeLinker slug={slug} />
      <BadgeWriter origin={BADGE_ORIGIN ?? NEXT_PUBLIC_APP_ORIGIN} />
    </>
  );
}
