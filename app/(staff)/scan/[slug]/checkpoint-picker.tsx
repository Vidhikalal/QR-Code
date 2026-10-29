'use client';

import { NativeDialog } from '@/components/ui/native-dialog';
import { Button } from '@/components/ui/button';

import { useEffect, useRef, useState } from 'react';
import { KIND_ICON, KIND_LABEL, type Checkpoint } from './types';

// SPEC §10.1: switching checkpoint requires confirmation (unless none is selected yet).
export function CheckpointPicker(props: {
  checkpoints: Checkpoint[];
  currentId: string | null;
  onChoose: (id: string) => void;
  onCancel: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const [pending, setPending] = useState<Checkpoint | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);

  function pick(cp: Checkpoint) {
    if (props.currentId === null) props.onChoose(cp.id);
    else if (cp.id !== props.currentId) setPending(cp);
    else props.onCancel();
  }

  return (
    <NativeDialog
      ref={ref}
      className="tw-scanner-dialog p-[28px] w-[min(92vw,_460px)] [box-shadow:rgba(0,_0,_0,_0.45)_0px_28px_90px] [&_h2]:m-[0px_0px_12px] [&_h2]:text-[24px] [&_h2]:tracking-[-0.035em] [&_p]:text-muted-foreground [&_p]:leading-[1.6]"
      aria-labelledby="picker-title"
      onCancel={(e) => {
        e.preventDefault();
        if (props.currentId !== null) props.onCancel();
      }}
    >
      {pending ? (
        <>
          <h2 id="picker-title">Switch to {pending.name}?</h2>
          <p>New scans will be recorded at {pending.name}.</p>
          <div className="flex gap-[10px] justify-end flex-wrap mt-[20px]">
            <Button type="button" variant="outline" onClick={() => setPending(null)}>
              Back
            </Button>
            <Button type="button" onClick={() => props.onChoose(pending.id)}>
              Switch to {pending.name}
            </Button>
          </div>
        </>
      ) : (
        <>
          <h2 id="picker-title">Choose your checkpoint</h2>
          {props.checkpoints.length === 0 && <p>This event has no checkpoints yet. Ask an organizer.</p>}
          <div className="grid gap-[10px] m-[20px_0px]">
            {props.checkpoints.map((cp) => (
              <Button
                key={cp.id}
                type="button"
                variant="secondary" className="min-h-[58px] justify-start gap-3 rounded-lg px-4 py-3 text-left hover:border-primary aria-pressed:border-primary aria-pressed:bg-primary/10 aria-pressed:outline aria-pressed:outline-primary [&_small]:text-xs [&_small]:text-muted-foreground"
                aria-pressed={cp.id === props.currentId}
                onClick={() => pick(cp)}
              >
                <span aria-hidden="true">{KIND_ICON[cp.kind]}</span>
                <span>
                  {cp.name} <small>· {KIND_LABEL[cp.kind]}{cp.isOpen ? '' : ' · closed'}</small>
                </span>
              </Button>
            ))}
          </div>
          {props.currentId !== null && (
            <div className="flex gap-[10px] justify-end flex-wrap mt-[20px]">
              <Button type="button" variant="outline" onClick={props.onCancel}>
                Cancel
              </Button>
            </div>
          )}
        </>
      )}
    </NativeDialog>
  );
}
