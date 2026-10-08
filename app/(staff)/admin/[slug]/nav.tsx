'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
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
