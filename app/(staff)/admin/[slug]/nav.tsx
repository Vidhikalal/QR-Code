'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useSyncExternalStore } from 'react';
import { nfcSupported } from '@/lib/scanner/nfc';
import styles from './admin.module.css';

const TABS = [
  ['', 'Dashboard'],
  ['/participants', 'Participants'],
  ['/checkpoints', 'Checkpoints'],
  ['/staff', 'Staff'],
  ['/sync', 'Sync'],
  ['/export', 'Export'],
] as const;

const subscribeNever = () => () => undefined;

export function AdminNav({ slug }: { slug: string }) {
  const pathname = usePathname();
  const base = `/admin/${slug}`;
  // §11: the Badges page needs Web NFC (Chrome on Android); elsewhere the tab isn't shown at all.
  const nfc = useSyncExternalStore(subscribeNever, nfcSupported, () => false);
  const tabs = nfc ? [...TABS, ['/badges', 'Badges'] as const] : TABS;
  return (
    <nav aria-label="Admin" className={styles.nav}>
      {tabs.map(([path, label]) => {
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
  );
}
