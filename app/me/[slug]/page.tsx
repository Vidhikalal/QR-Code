import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db/server';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { env } from '@/lib/env';
import { myPasses } from '@/lib/pass/mine';
import styles from '../../profile/[uid]/profile.module.css';
import me from '../me.module.css';
import { loadMyEvent, menuMetadata } from './load';

export const metadata: Metadata = menuMetadata('Menu');

// SPEC F14 (v0.6): what an attendee sees when they tap their own badge, or open an event from /me.
export default async function HackerMenuPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const { user, me: m } = await loadMyEvent(slug, `/me/${slug}`);
  const pass = (await myPasses(db(), user.email ?? '', env().PASS_TOKEN_SECRET, new Date())).find((p) => p.participantId === m.participantId)?.pass;
  const base = `/me/${m.slug}`;

  return (
    <main className={styles.page}>
      <Link className={me.back} href="/me">
        ← My events
      </Link>
      <p className={styles.eyebrow}>
        {formatEventDateTime(m.event.startsAt, m.event.timezone)} · {m.event.venue}
      </p>
      <h1>{m.event.name}</h1>
      <p>Hi {m.firstName}.</p>
      <nav aria-label="Hacker menu">
        <ul className={me.menu}>
          <li>
            <Link className={me.item} href={`${base}/profile`}>
              Hacker profile
            </Link>
          </li>
          <li>
            <Link className={me.item} href={`${base}/schedule`}>
              Schedule
            </Link>
          </li>
          <li>
            <Link className={me.item} href={`${base}/emergency`}>
              Emergency contact
            </Link>
          </li>
          <li>
            {typeof pass === 'object' ? (
              // A plain link: the token is in the fragment (I-3), which client navigation must not touch.
              <a className={me.item} href={`/p#${pass.token}`}>
                My pass
              </a>
            ) : (
              <p className={me.item}>
                My pass
                <small>{pass === 'in_email' ? 'In your email' : pass === 'on_its_way' ? 'On its way by email' : 'The event is over'}</small>
              </p>
            )}
          </li>
        </ul>
      </nav>
    </main>
  );
}
