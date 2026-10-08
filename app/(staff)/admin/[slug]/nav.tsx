'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useState } from 'react';
import styles from './admin.module.css';

const TABS = [
  ['', 'Dashboard'],
  ['/participants', 'Participants'],
  ['/checkpoints', 'Checkpoints'],
  ['/staff', 'Staff'],
  ['/sync', 'Sync'],
  ['/export', 'Export'],
  ['/settings', 'Settings'],
] as const;

export interface SwitcherEvent {
  slug: string;
  name: string;
  href: string;
  role: string | null;
}

// PLAN F15: the organizer's own badge profile on the ME host, via a one-time sign-in code.
function BadgeProfileButton({ slug }: { slug: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'failed'>('idle');
  async function hop() {
    setState('busy');
    const res = await fetch('/api/staff/hop', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ slug }) }).catch(() => null);
    const data = (await res?.json().catch(() => ({}))) as { url?: string };
    if (res?.ok && data.url) window.location.assign(data.url);
    else setState('failed');
  }
  return (
    <>
      <button type="button" className={`${styles.secondary} ${styles.small}`} disabled={state === 'busy'} onClick={() => void hop()}>
        My badge profile
      </button>
      {state === 'failed' && <span role="status">✕ Couldn’t open your profile. Try again.</span>}
    </>
  );
}

export function AdminNav({ slug, events }: { slug: string; events: SwitcherEvent[] }) {
  const pathname = usePathname();
  const router = useRouter();
  const base = `/admin/${slug}`;
  return (
    <>
      <div className={styles.toolbar}>
        <label className={styles.field}>
          Event
          <select
            className={styles.input}
            data-testid="event-switcher"
            value={slug}
            onChange={(e) => {
              const target = events.find((ev) => ev.slug === e.target.value);
              if (target) router.push(target.href);
            }}
          >
            {events.map((e) => (
              <option key={e.slug} value={e.slug}>
                {e.name}
                {e.role === 'volunteer' ? ' (volunteer: scanner)' : ''}
              </option>
            ))}
          </select>
        </label>
        <Link href="/admin" className={styles.tab}>
          All events
        </Link>
        <BadgeProfileButton slug={slug} />
      </div>
      <nav aria-label="Admin" className={styles.nav}>
        {TABS.map(([path, label]) => {
          const href = base + path;
          return (
            <Link key={label} href={href} className={styles.tab} aria-current={pathname === href ? 'page' : undefined}>
              {label}
            </Link>
          );
        })}
        <Link href={`/scan/${slug}`} className={styles.tab}>
          Scanner ↗
        </Link>
      </nav>
    </>
  );
}
