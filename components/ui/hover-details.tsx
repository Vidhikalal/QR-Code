'use client';

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type DOMAttributes, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

// Triggers already expose these details as text or an accessible name. The visual
// copy is hidden from AT so focusing a trigger reads the information only once.
export function useHoverDetails() {
  const [active, setActive] = useState<{ anchor: Element; content: ReactNode } | null>(null);
  const card = useRef<HTMLDivElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pinned = useRef(false);
  const hovering = useRef(false);
  const cancel = useCallback(() => { if (timer.current) clearTimeout(timer.current); }, []);
  const close = useCallback(() => { cancel(); pinned.current = false; hovering.current = false; setActive(null); }, [cancel]);
  const leave = () => {
    hovering.current = false;
    cancel();
    timer.current = setTimeout(() => {
      if (!pinned.current && !hovering.current && document.activeElement !== active?.anchor) setActive(null);
    }, 100);
  };
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  useEffect(() => {
    if (!active) return;
    const outside = (event: PointerEvent) => {
      if (event.target instanceof Node && !active.anchor.contains(event.target) && !card.current?.contains(event.target)) close();
    };
    const escape = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [active, close]);
  useLayoutEffect(() => {
    if (!active || !card.current) return;
    const position = () => {
      const element = card.current;
      if (!element) return;
      const anchor = active.anchor.getBoundingClientRect();
      const { width, height } = element.getBoundingClientRect();
      const margin = 8;
      const left = anchor.left + width <= window.innerWidth - margin ? anchor.left : anchor.right - width;
      const top = anchor.bottom + margin + height <= window.innerHeight - margin ? anchor.bottom + margin : anchor.top - height - margin;
      element.style.left = `${Math.max(margin, Math.min(left, window.innerWidth - width - margin))}px`;
      element.style.top = `${Math.max(margin, Math.min(top, window.innerHeight - height - margin))}px`;
    };
    position();
    window.addEventListener('resize', position);
    window.addEventListener('scroll', position, true);
    return () => { window.removeEventListener('resize', position); window.removeEventListener('scroll', position, true); };
  }, [active]);
  const bind = (content: ReactNode): DOMAttributes<Element> => ({
    onPointerEnter: event => {
      if (event.pointerType === 'touch') return;
      cancel(); hovering.current = true; setActive({ anchor: event.currentTarget, content });
    },
    onPointerLeave: leave,
    onFocus: event => { cancel(); setActive({ anchor: event.currentTarget, content }); },
    onBlur: () => { if (!pinned.current && !hovering.current) close(); },
    onPointerUp: event => {
      if (event.pointerType === 'touch') { cancel(); pinned.current = true; setActive({ anchor: event.currentTarget, content }); }
    },
  });
  const overlay = active && createPortal(
    <div ref={card} data-testid="hover-details" aria-hidden="true"
      onPointerEnter={() => { cancel(); hovering.current = true; }} onPointerLeave={leave}
      className="fixed z-[100] box-border w-max max-w-[min(20rem,calc(100vw-16px))] max-h-[calc(100dvh-16px)] overflow-auto rounded-md border border-line bg-card p-3 font-mono text-xs leading-relaxed text-fg shadow-panel [overflow-wrap:anywhere]">
      {active.content}
    </div>, document.body,
  );
  return { bind, overlay };
}
