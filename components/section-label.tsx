import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

// Theme from datafest-website/src/components/SectionLabel.tsx.
export function SectionLabel({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn('flex items-baseline gap-3 mb-2.5', className)}>
    <span className="font-mono uppercase tracking-[0.3em] text-[var(--ink-label)] text-[10px] sm:text-xs">{children}</span>
    <span aria-hidden="true" className="flex-1 h-px bg-[var(--edge)]" />
  </div>;
}
