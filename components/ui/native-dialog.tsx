'use client';

import { useEffect, useImperativeHandle, useRef, type ComponentProps } from 'react';
import { animate } from 'motion/react';
import { cn } from '@/lib/utils';

// Keep the native top layer, focus restoration and cancel/close events used by the scanner.
export function NativeDialog({ className, ref, ...props }: ComponentProps<'dialog'>) {
  const element = useRef<HTMLDialogElement>(null);
  useImperativeHandle(ref, () => element.current!);
  useEffect(() => {
    const dialog = element.current;
    if (!dialog || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let animation: ReturnType<typeof animate> | undefined;
    const enter = () => {
      if (dialog.open) animation = animate(dialog, { opacity: [0.9, 1], scale: [0.98, 1] }, { duration: 0.16, ease: [0.23, 1, 0.32, 1] });
    };
    const observer = new MutationObserver(enter);
    observer.observe(dialog, { attributes: true, attributeFilter: ['open'] });
    enter();
    return () => { observer.disconnect(); animation?.stop(); };
  }, []);
  return <dialog ref={element} data-slot="dialog" className={cn('rounded-md border border-solid border-border bg-popover shadow-panel p-6 text-popover-foreground backdrop:bg-bg-deep/75', className)} {...props} />;
}
