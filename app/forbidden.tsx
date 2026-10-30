import { BrandMark } from '@/components/brand-mark';

import { Entrance } from '@/components/motion';
import Link from 'next/link';

// Rendered with HTTP 403 when a page calls forbidden() (e.g. a volunteer opening /admin).
export default function Forbidden() {
  return (
    <Entrance><main style={{ maxWidth: 420, margin: '0 auto', padding: '32px 16px' }}>
      <BrandMark />
      <h1>✕ Organizer access only</h1>
      <p className="copy">You’re signed in, but you aren’t an organizer of this event. Ask an organizer to invite you.</p>
      <Link href="/">Home</Link>
    </main></Entrance>
  );
}
