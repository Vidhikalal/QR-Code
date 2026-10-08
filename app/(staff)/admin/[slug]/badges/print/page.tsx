import type { Metadata } from 'next';
import Image from 'next/image';
import { forbidden } from 'next/navigation';
import { requireStaffBySlug } from '@/lib/auth/staff';
import { currentUser } from '@/lib/auth/session';
import { tagUrl } from '@/lib/badge/tags';
import { db } from '@/lib/db/server';
import { env } from '@/lib/env';
import { renderQrPng } from '@/lib/qr/render';
import styles from './print.module.css';

export const metadata: Metadata = { title: 'Badge print sheet · Passline', robots: { index: false } };

// PLAN §11.5 (Q9): a printed QR backup per badge. Opaque white, rendered server-side (§6.2). The QR is
// the badge URL, so the camera scanner treats it exactly like a tap. The layout already requires an
// organizer; this re-checks before reading tags (I-5).
export default async function PrintPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await currentUser();
  const staff = user ? await requireStaffBySlug(db(), user.id, slug, 'organizer') : null;
  if (!staff) forbidden();
  const { data, error } = await db().from('tags').select('id, public_id, label').eq('event_id', staff.eventId).is('retired_at', null).order('label');
  if (error) throw new Error(`tags load failed (${error.code})`);
  const origin = env().NEXT_PUBLIC_APP_ORIGIN;
  const cards = await Promise.all(
    data.map(async (t) => ({ id: t.id, label: t.label, src: `data:image/png;base64,${(await renderQrPng(tagUrl(origin, t.public_id))).toString('base64')}` })),
  );
  return (
    <section className={styles.sheet} aria-label="Badge QR codes">
      <p className={styles.screenOnly}>
        {cards.length} badges. Print with your browser (⌘P / Ctrl+P); navigation is hidden on paper.
      </p>
      <div className={styles.grid}>
        {cards.map((c) => (
          // unoptimized: a data: URI is printed exactly as rendered (the CSP allows data: images).
          <figure key={c.id} className={styles.card}>
            <Image src={c.src} alt={`QR code for badge ${c.label ?? ''}`} width={160} height={160} unoptimized data-testid="badge-qr" />
            <figcaption>{c.label ?? ''}</figcaption>
          </figure>
        ))}
      </div>
    </section>
  );
}
