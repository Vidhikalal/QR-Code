'use client';

import { Entrance } from '@/components/motion';

import type { ResultView } from '@/lib/scanner/result-view';

// SPEC §10.2: icon + text + colour together; names ≥ 32 px. Flat fills (Tailwind 700 shades) keep white text above 4.5:1.
// A plain button, not the shared Button: its hover colours must never reach this screen. Only green (and the
// "Not a Datathon code" notice) auto-dismiss; every problem needs a tap so the volunteer notices it.
export function ResultScreen({ view, shownAt, onDismiss }: { view: ResultView; shownAt: number; onDismiss: () => void }) {
  const tap = view.dismiss === 'tap';
  return (
    <button
      type="button"
      className="fixed inset-0 z-20 m-0 flex w-full rounded-none flex-col items-center justify-center gap-4 border-0 p-8 text-center font-mono text-base text-white whitespace-normal cursor-pointer
        focus-visible:outline-2 focus-visible:-outline-offset-8 focus-visible:outline-white
        data-[tone=green]:bg-[#15803d] data-[tone=amber]:bg-[#b45309] data-[tone=red]:bg-[#b91c1c]"
      data-tone={view.tone}
      data-testid="scan-result"
      data-shown-at={shownAt}
      data-dismiss={tap ? 'tap' : 'auto'}
      onClick={onDismiss}
      aria-describedby="result-hint"
    >
      <Entrance pop><span className="tw-scanner-resultIcon text-[76px] leading-[1]" aria-hidden="true">
        {view.icon}
      </span></Entrance>
      <span role="status" aria-live="assertive">
        <strong className="text-[clamp(28px,_4vw,_40px)] font-bold tracking-tight m-0">{view.headline}</strong>
      </span>
      {view.name && <span className="text-[clamp(32px,_3vw,_38px)] font-bold m-0 [overflow-wrap:anywhere]">{view.name}</span>}
      {view.emphasis && <span className="text-[22px] font-extrabold [background:rgba(0,_0,_0,_0.22)] [border-width:1px] [border-style:solid]

          [border-color:rgba(255,_255,_255,_0.18)] p-[10px_16px] rounded-card">{view.emphasis}</span>}
      {view.detail && <span className="text-[17px] leading-[1.6] m-0 max-w-[520px] opacity-[0.9]">{view.detail}</span>}
      <span id="result-hint" className="text-[14px] opacity-[0.78] mt-[8px]">
        {tap ? 'Tap to continue' : 'Tap to skip'}
      </span>
    </button>
  );
}
