'use client';

import { useEffect, useRef, useState, type ReactNode } from 'react';

// Full text is the server/default state and always supplies the accessible name and layout.
export function Typewriter({ heading, details, children }: { heading: string; details: ReactNode; children: ReactNode }) {
  const greeting = useRef<HTMLSpanElement>(null);
  const [frame, setFrame] = useState<{ heading: string; greeting: string; cursor: 'heading' | 'greeting' } | null>(null);

  useEffect(() => {
    const preference = window.matchMedia('(prefers-reduced-motion: reduce)');
    if (preference.matches) return;
    const title = Array.from(heading);
    const text = Array.from(greeting.current?.textContent ?? '');
    const pause = 140;
    const step = Math.min(22, (2400 - pause) / Math.max(1, title.length + text.length));
    const titleEnd = title.length * step;
    const end = titleEnd + pause + text.length * step;
    const start = performance.now();
    let animation: number;

    function tick(now: number) {
      const elapsed = now - start;
      if (elapsed >= end || preference.matches) {
        setFrame(null);
        return;
      }
      setFrame({
        heading: title.slice(0, Math.floor(elapsed / step)).join(''),
        greeting: text.slice(0, Math.max(0, Math.floor((elapsed - titleEnd - pause) / step))).join(''),
        cursor: elapsed < titleEnd + pause ? 'heading' : 'greeting',
      });
      animation = requestAnimationFrame(tick);
    }

    function finish() {
      if (preference.matches) {
        cancelAnimationFrame(animation);
        setFrame(null);
      }
    }

    animation = requestAnimationFrame(tick);
    preference.addEventListener('change', finish);
    return () => {
      cancelAnimationFrame(animation);
      preference.removeEventListener('change', finish);
    };
  }, [heading]);

  const cursor = <span className="absolute text-accent animate-pulse">▎</span>;

  return (
    <>
      <h1 className="relative">
        <span style={{ opacity: frame ? 0 : 1 }}>{heading}</span>
        {frame && <span aria-hidden="true" className="absolute inset-0 pointer-events-none">{frame.heading}{frame.cursor === 'heading' && cursor}</span>}
      </h1>
      {details}
      <p className="copy relative">
        <span ref={greeting} style={{ opacity: frame ? 0 : 1 }}>{children}</span>
        {frame && <span aria-hidden="true" className="absolute inset-0 pointer-events-none">{frame.greeting}{frame.cursor === 'greeting' && cursor}</span>}
      </p>
    </>
  );
}
