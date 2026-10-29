'use client';

import { Card } from '@/components/ui/card';
import { Entrance } from '@/components/motion';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { searchQuery } from '@/lib/domain/search';
import { nfcSupported } from '@/lib/scanner/nfc';

export interface Row {
  id: string;
  displayName: string;
  status: string;
  email: string;
  scannedHere: boolean;
  hasBadge: boolean;
}

type SearchState = { kind: 'idle' } | { kind: 'loading' } | { kind: 'rows'; rows: Row[] } | { kind: 'error' };
const subscribeNever = () => () => undefined;

// SPEC §10.4. Results come from the server; nothing is cached on the device.
export function ManualSearch(props: {
  slug: string;
  checkpointId: string;
  disabled: boolean;
  onRecord: (participantId: string) => void;
  onLinkBadge: (row: Row) => void;
  onClose: () => void;
  onUnauthorized: () => void;
}) {
  const { slug, checkpointId, disabled } = props;
  const [q, setQ] = useState('');
  const [state, setState] = useState<SearchState>({ kind: 'idle' });
  const valid = searchQuery(q) !== null;
  const supported = useSyncExternalStore(subscribeNever, nfcSupported, () => false);
  const onUnauthorized = useRef(props.onUnauthorized);

  useEffect(() => {
    onUnauthorized.current = props.onUnauthorized;
  }, [props.onUnauthorized]);

  useEffect(() => {
    if (!valid || disabled) return;
    let stale = false;
    const t = setTimeout(async () => {
      setState({ kind: 'loading' });
      try {
        const url = `/api/events/${encodeURIComponent(slug)}/participants/search?q=${encodeURIComponent(q)}&checkpointId=${checkpointId}`;
        const res = await fetch(url, { cache: 'no-store' });
        if (stale) return;
        if (res.status === 401) return onUnauthorized.current();
        if (!res.ok) return setState({ kind: 'error' });
        const body = (await res.json()) as { results: Row[] };
        if (!stale) setState({ kind: 'rows', rows: body.results });
      } catch {
        if (!stale) setState({ kind: 'error' });
      }
    }, 250);
    return () => {
      stale = true;
      clearTimeout(t);
    };
  }, [slug, checkpointId, q, valid, disabled]);

  return (
    <Entrance><Card className="tw-scanner-sheet gap-0 rounded-none border-0 bg-background p-0 shadow-none fixed [inset:0px] z-[15] [background:var(--bg)] text-fg flex flex-col" asChild><section  aria-labelledby="search-title">
      <div className="flex gap-[12px] items-center p-[20px_24px] [border-bottom-width:1px] [border-bottom-style:solid]

          [border-bottom-color:var(--line)] [background:var(--card)] [&_h2]:flex-1 [&_h2]:m-0 [&_h2]:text-[22px]

          [&_h2]:tracking-[-0.03em]">
        <h2 id="search-title">Manual search</h2>
        <Button type="button" variant="outline" onClick={props.onClose}>
          Close
        </Button>
      </div>
      <Label htmlFor="manual-q" className="sr-only">
        Name
      </Label>
      <Input
        id="manual-q"
        className="mx-6 mt-5 mb-3 min-h-[52px] w-[calc(100%_-_3rem)] rounded-lg bg-card px-4"
        placeholder="Type a name"
        autoComplete="off"
        autoFocus
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />
      {!valid && q !== '' && <p className="p-[0px_24px_16px] text-muted-foreground text-[14px]">Type at least 2 letters.</p>}
      {valid && state.kind === 'loading' && <p className="p-[0px_24px_16px] text-muted-foreground text-[14px]">Searching…</p>}
      {valid && state.kind === 'error' && <p className="p-[0px_24px_16px] text-muted-foreground text-[14px]">✕ Search failed. Try again.</p>}
      {valid && state.kind === 'rows' && state.rows.length === 0 && <p className="p-[0px_24px_16px] text-muted-foreground text-[14px]">No one found.</p>}
      {valid && state.kind === 'rows' && (
        <ul className="list-none m-0 p-[0px_24px_28px] overflow-y-auto">
          {state.rows.map((r) => (
            <li key={r.id} className="flex gap-[14px] items-center p-[16px_0px] [border-bottom-width:1px] [border-bottom-style:solid]

          [border-bottom-color:var(--line)]" data-testid="search-row">
              <div className="flex-1 min-w-0">
                <div className="[font-weight:750] text-[16px] mb-[5px]">{r.displayName}</div>
                <div className="text-[13px] leading-[1.8] text-muted-foreground">
                  <Badge className="mr-1.5">{r.status}</Badge>
                  {r.scannedHere && <Badge className="tw-scanner-badgeWarn mr-1.5 border-warn/30 bg-warn/12 text-warn">✓ Already scanned here</Badge>}
                  {r.hasBadge && <Badge className="mr-1.5">Badge linked</Badge>}
                  {r.email}
                </div>
              </div>
              <div className="grid gap-[8px] [flex:0_0_auto]">
                <Button type="button" disabled={disabled} onClick={() => props.onRecord(r.id)} aria-label={`Record scan for ${r.displayName}`}>
                  Record scan
                </Button>
                {supported && r.status === 'accepted' && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => props.onLinkBadge(r)}
                    aria-label={`${r.hasBadge ? 'Replace' : 'Link'} badge for ${r.displayName}`}
                  >
                    {r.hasBadge ? 'Replace badge' : 'Link badge'}
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}
    </section></Card></Entrance>
  );
}
