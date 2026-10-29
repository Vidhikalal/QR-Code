'use client';

import { NativeDialog } from '@/components/ui/native-dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';

import { useEffect, useRef, useState } from 'react';

const QUICK = ['Wrong checkpoint', 'Wrong person', 'Test scan'] as const;

// SPEC §10.3: a reason is required (3–200 chars); quick picks or "Other".
export function UndoDialog(props: { title?: string; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [other, setOther] = useState<string | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  const otherValid = other !== null && other.trim().length >= 3 && other.trim().length <= 200;

  return (
    <NativeDialog
      ref={ref}
      className="tw-scanner-dialog p-[28px] w-[min(92vw,_460px)] [box-shadow:rgba(0,_0,_0,_0.45)_0px_28px_90px] [&_h2]:m-[0px_0px_12px] [&_h2]:text-[24px] [&_h2]:tracking-[-0.035em] [&_p]:text-muted-foreground [&_p]:leading-[1.6]"
      aria-labelledby="undo-title"
      onCancel={(e) => {
        e.preventDefault();
        props.onCancel();
      }}
    >
      <h2 id="undo-title">{props.title ?? 'Undo last scan'}</h2>
      <p>Why are you undoing it?</p>
      <div className="grid gap-[10px] m-[20px_0px]">
        {QUICK.map((r) => (
          <Button key={r} type="button" variant="secondary" className="min-h-[58px] justify-start gap-3 rounded-lg px-4 py-3 text-left hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:outline aria-pressed:outline-primary [&_small]:text-xs [&_small]:text-muted-foreground" onClick={() => props.onSubmit(r)}>
            {r}
          </Button>
        ))}
        {other === null ? (
          <Button type="button" variant="secondary" className="min-h-[58px] justify-start gap-3 rounded-lg px-4 py-3 text-left hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:outline aria-pressed:outline-primary [&_small]:text-xs [&_small]:text-muted-foreground" onClick={() => setOther('')}>
            Other…
          </Button>
        ) : (
          <>
            <Label htmlFor="undo-other">Reason</Label>
            <Input id="undo-other" className="min-h-12 w-full" value={other} maxLength={200} onChange={(e) => setOther(e.target.value)} autoFocus />
            <Button type="button" disabled={!otherValid} onClick={() => props.onSubmit(other.trim())}>
              Undo with this reason
            </Button>
          </>
        )}
      </div>
      <div className="flex gap-[10px] justify-end flex-wrap mt-[20px]">
        <Button type="button" variant="outline" onClick={props.onCancel}>
          Keep the scan
        </Button>
      </div>
    </NativeDialog>
  );
}
