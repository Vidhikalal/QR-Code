'use client';

import { usePathname } from 'next/navigation';
import ConstellationBackground from './constellation-background';

// Ground ported from datafest-website/src/components/SiteBackground.tsx.
export function SiteBackground() {
  const pathname = usePathname();
  if (pathname === '/scan' || pathname.startsWith('/scan/')) return null;
  return <>
    <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: -10, pointerEvents: 'none' }}>
      <ConstellationBackground />
    </div>
    <div className="page-veil" aria-hidden="true" />
    <div className="page-grain" aria-hidden="true" />
  </>;
}
