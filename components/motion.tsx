'use client';

import { useEffect, type ReactNode, type ReactElement } from 'react';
import { MotionConfig, useAnimate } from 'motion/react';
import { Slot } from '@radix-ui/react-slot';

export function MotionProvider({ children }: { children: ReactNode }) {
  return <MotionConfig reducedMotion="user" transition={{ duration: 0.16, ease: 'easeOut' }}>{children}</MotionConfig>;
}

// Server markup stays visible. Each mounted surface enters once; data refreshes do not replay it.
export function Entrance({ children, stagger = false, pop = false }: { children: ReactElement; stagger?: boolean; pop?: boolean }) {
  const [scope, animate] = useAnimate();
  useEffect(() => {
    if (!scope.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const targets: HTMLElement[] = stagger ? Array.from(scope.current.children) : [scope.current];
    const animations = targets.map((target, index) => animate(target, { opacity: [0.88, 1], y: pop ? [0, 0] : [4, 0], scale: pop ? [0.97, 1] : [1, 1] }, { duration: 0.16, ease: 'easeOut', delay: Math.min(index, 3) * 0.012 }));
    return () => animations.forEach((animation) => animation.stop());
  }, [animate, scope, stagger, pop]);
  return <Slot ref={scope}>{children}</Slot>;
}
