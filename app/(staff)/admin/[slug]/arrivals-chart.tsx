'use client';

import { Alert } from '@/components/ui/alert';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';

import { useState } from 'react';

export interface ArrivalBucket {
  bucketUtc: string;
  label: string; // already in the event timezone (§13, I-8)
  arrivals: number;
}

const W = 720;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 28, left: 36 };

// Whole-number ticks (these are head counts): a 1/2/5 × 10^k step giving at most ~4 intervals.
function niceScale(peak: number): { max: number; ticks: number[] } {
  const rough = Math.max(1, peak / 4);
  const pow = 10 ** Math.floor(Math.log10(rough));
  const step = [1, 2, 5, 10].map((m) => m * pow).find((s) => s >= rough) ?? 10 * pow;
  const max = Math.max(step, Math.ceil(peak / step) * step);
  return { max, ticks: Array.from({ length: max / step + 1 }, (_, i) => i * step) };
}

// Rounded 4px top, square at the baseline (dataviz mark spec).
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

// Door arrivals per 15-minute bucket. One series, so no legend: the heading names it.
export function ArrivalsChart({ buckets }: { buckets: ArrivalBucket[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (buckets.length === 0) return <p className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">No door check-ins yet.</p>;

  const { max, ticks } = niceScale(Math.max(...buckets.map((b) => b.arrivals)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / buckets.length;
  const barW = Math.min(24, Math.max(2, slot - 2)); // ≤ 24px, ≥ 2px surface gap
  const labelEvery = Math.max(1, Math.ceil(buckets.length / 8));
  const hovered = hover === null ? undefined : buckets[hover];

  return (
    <div className="relative

          [background:var(--surface)]

          [border-width:1px] [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-ticket p-[24px]

          overflow-visible mt-[4px] shadow-panel max-[600.001px]:p-[16px_10px] [&_svg]:block [&_svg]:w-full

          [&_svg]:h-auto [&_svg]:max-w-full [&_svg]:overflow-visible">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`Door arrivals per 15 minutes, ${buckets.length} buckets, peak ${Math.max(...buckets.map((b) => b.arrivals))}`}>
        {ticks.map((t) => {
          const y = PAD.top + plotH - (t / max) * plotH;
          return (
            <g key={t}>
              <line className="[stroke:var(--line)] [stroke-width:1] opacity-[0.8]" x1={PAD.left} x2={W - PAD.right} y1={y} y2={y} />
              <text className="[fill:var(--muted-foreground)] text-[11px]" x={PAD.left - 6} y={y + 4} textAnchor="end">
                {t.toLocaleString('en-US')}
              </text>
            </g>
          );
        })}
        {buckets.map((b, i) => {
          const h = (b.arrivals / max) * plotH;
          const cx = PAD.left + slot * i + slot / 2;
          return (
            <g key={b.bucketUtc}>
              <rect
                className="[fill:transparent] cursor-pointer [outline:none]

          [&:hover_+_.tw-admin-chartBar]:[fill:rgb(167,_243,_208)]

          [&:focus-visible_+_.tw-admin-chartBar]:[fill:rgb(167,_243,_208)] [&:focus-visible]:[stroke:var(--fg)]

          [&:focus-visible]:[stroke-width:2]"
                x={PAD.left + slot * i}
                y={PAD.top}
                width={slot}
                height={plotH}
                tabIndex={0}
                aria-label={`${b.label}: ${b.arrivals} arrivals`}
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(null)}
                onFocus={() => setHover(i)}
                onBlur={() => setHover(null)}
              />
              {h > 0 && <path className="tw-admin-chartBar [fill:var(--accent)] [transition:opacity_150ms_var(--ease)] [&:hover]:opacity-[0.75]" d={barPath(cx - barW / 2, PAD.top + plotH - h, barW, h)} pointerEvents="none" />}
              {i % labelEvery === 0 && (
                <text className="[fill:var(--muted-foreground)] text-[11px]" x={cx} y={H - 8} textAnchor="middle">
                  {b.label.replace(/\s\S+$/, '')}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {hovered && hover !== null && (
        <Alert className="absolute [pointer-events:none] [background:var(--bg-deep)] text-fg [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] text-[12px] p-[10px_12px]

          rounded-control whitespace-nowrap [transform:translate(-50%,_-100%)] shadow-panel" asChild role="status"><div

          style={{ left: `${((PAD.left + slot * hover + slot / 2) / W) * 100}%`, top: 12 }}
          role="status"
        >
          {hovered.label} · {hovered.arrivals}
        </div></Alert>
      )}
      <details className="[&_summary]:cursor-pointer [&_summary]:min-h-[44px] [&_summary]:flex [&_summary]:items-center

          [&_summary]:text-link [&_summary]:text-[13px] [&_summary]:font-semibold">
        <summary>Show as table</summary>
        <Table className="tw-admin-table [&_.tw-admin-num]:text-right! [&_.tw-admin-actions]:flex [&_.tw-admin-actions]:items-center [&_.tw-admin-actions]:gap-1 [&_.tw-admin-actions_button]:px-2 [&_.tw-admin-actions_button]:text-xs [&_.tw-admin-badge]:text-xs">
          <TableHeader>
            <TableRow>
              <TableHead>Starting</TableHead>
              <TableHead className="tw-admin-num text-right! tabular-nums">Arrivals</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {buckets.map((b) => (
              <TableRow key={b.bucketUtc}>
                <TableCell>{b.label}</TableCell>
                <TableCell className="tw-admin-num text-right! tabular-nums">{b.arrivals}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </details>
    </div>
  );
}
