'use client';

import { Entrance } from '@/components/motion';
import { Button } from '@/components/ui/button';

import type { ResultView } from '@/lib/scanner/result-view';

// SPEC §10.2: icon + text + colour together; names ≥ 32 px. Only green (and the
// "Not a Datathon code" notice) auto-dismiss; every problem needs a tap so the volunteer notices it.
export function ResultScreen({ view, shownAt, onDismiss }: { view: ResultView; shownAt: number; onDismiss: () => void }) {
  const tap = view.dismiss === 'tap';
  return (
    <Button
      type="button"
      className="fixed [inset:0px] z-[20] flex flex-col items-center justify-center gap-[16px] p-[32px] text-center

          text-white [border-width:0px] [border-style:none] [border-color:currentcolor]

          rounded-none font-normal w-full whitespace-normal motion-safe:active:scale-100

          [&[data-tone='green']]:[background:radial-gradient(at_center_top,_rgb(22,_101,_52),_rgb(5,_46,_22)_75%)]

          [&[data-tone='amber']]:[background:radial-gradient(at_center_top,_rgb(146,_64,_14),_rgb(69,_26,_3)_75%)]

          [&[data-tone='red']]:[background:radial-gradient(at_center_top,_rgb(153,_27,_27),_rgb(69,_10,_10)_75%)]"
      data-tone={view.tone}
      data-testid="scan-result"
      data-shown-at={shownAt}
      data-dismiss={tap ? 'tap' : 'auto'}
      onClick={onDismiss}
      aria-describedby="result-hint"
    >
      <Entrance pop><span className="tw-scanner-resultIcon text-[76px] leading-[1] [filter:drop-shadow(rgba(0,_0,_0,_0.2)_0px_8px_24px)]" aria-hidden="true">
        {view.icon}
      </span></Entrance>
      <span role="status" aria-live="assertive">
        <strong className="text-[clamp(28px,_4vw,_40px)] [font-weight:850] tracking-[-0.04em] m-0">{view.headline}</strong>
      </span>
      {view.name && <span className="text-[clamp(32px,_3vw,_38px)] font-bold m-0 [overflow-wrap:anywhere]">{view.name}</span>}
      {view.emphasis && <span className="text-[22px] font-extrabold [background:rgba(0,_0,_0,_0.22)] [border-width:1px] [border-style:solid]

          [border-color:rgba(255,_255,_255,_0.18)] p-[10px_16px] rounded-card">{view.emphasis}</span>}
      {view.detail && <span className="text-[17px] leading-[1.6] m-0 max-w-[520px] opacity-[0.9]">{view.detail}</span>}
      <span id="result-hint" className="text-[14px] opacity-[0.78] mt-[8px]">
        {tap ? 'Tap to continue' : 'Tap to skip'}
      </span>
    </Button>
  );
}
