'use client';

import { NativeDialog } from '@/components/ui/native-dialog';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

import { useEffect, useRef, useState, type ReactNode } from 'react';

// A modal <dialog>, opened on mount. Escape = cancel.
export function Modal(props: { title: string; onCancel: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    return () => dialog?.close();
  }, []);
  return (
    <NativeDialog
      ref={ref}
      className="tw-admin-dialog p-[24px] w-[min(92vw,_440px)] max-w-[440px] max-h-[min(85dvh,_720px)] overflow-y-auto [box-shadow:rgba(0,_0,_0,_0.533)_0px_24px_80px] [overscroll-behavior:contain] max-[480.001px]:rounded-card max-[480.001px]:p-[18px] max-[480.001px]:w-[calc(-24px_+_100vw)] [&_h2]:mt-0 [&_>_h2]:m-[0px_0px_20px] [&_>_h2]:text-[21px] [&_>_h2]:leading-[1.3] [&_>_h2]:tracking-[-0.035em] max-[480.001px]:[&_>_h2]:m-[0px_0px_16px] max-[480.001px]:[&_>_h2]:text-[19px] [&_p]:text-[13px] [&_p]:leading-[1.65] [&_.tw-admin-field]:grid [&_.tw-admin-field]:gap-[6px] [&_.tw-admin-field]:min-w-0 [&_.tw-admin-field]:text-muted-foreground [&_.tw-admin-field]:text-[11px] [&_.tw-admin-field]:font-semibold [&_.tw-admin-field]:tracking-[0.03em] [&_.tw-admin-field]:normal-case [&_.tw-admin-input]:w-full [&_.tw-admin-input]:min-h-[44px] [&_.tw-admin-input]:p-[10px_12px] [&_.tw-admin-input]:rounded-control [&_.tw-admin-input]: [&_.tw-admin-input]:[font-family:inherit] [&_.tw-admin-input]:text-[14px] [&_.tw-admin-input]:tracking-[normal] [&_.tw-admin-check]:flex [&_.tw-admin-check]:items-center [&_.tw-admin-check]:gap-[9px] [&_.tw-admin-check]: [&_.tw-admin-check]:text-[13px] [&_.tw-admin-check]:font-medium [&_.tw-admin-check]:tracking-[normal] [&_.tw-admin-check]:normal-case [&_.tw-admin-check_input]:w-[16px] [&_.tw-admin-check_input]:h-[16px] [&_.tw-admin-check_input]:[accent-color:var(--accent)] [&_button:focus-visible]:[outline:2px_solid_var(--accent)] [&_button:focus-visible]:[outline-offset:2px]"
      aria-label={props.title}
      onCancel={(e) => {
        e.preventDefault();
        props.onCancel();
      }}
    >
      <h2>{props.title}</h2>
      {props.children}
    </NativeDialog>
  );
}

// Every destructive admin action goes through this. `typeToConfirm` adds a typed safeguard.
export function ConfirmDialog(props: {
  title: string;
  body: ReactNode;
  confirmLabel: string;
  danger?: boolean;
  typeToConfirm?: string;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const [typed, setTyped] = useState('');
  const ok = !props.typeToConfirm || typed.trim() === props.typeToConfirm;
  return (
    <Modal title={props.title} onCancel={props.onCancel}>
      <div>{props.body}</div>
      {props.typeToConfirm && (
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
          Type {props.typeToConfirm} to confirm
          <Input className="tw-admin-input w-full" value={typed} onChange={(e) => setTyped(e.target.value)} autoFocus />
        </Label>
      )}
      <div className="flex gap-[8px] justify-end flex-wrap mt-[8px] pt-[14px] [border-top-width:1px] [border-top-style:solid]

          [border-top-color:var(--line)] [&_button]:min-h-[44px] [&_button]:p-[8px_12px] [&_button]:rounded-md

          [&_button]:[font-family:inherit] [&_button]:text-[12px] [&_button]:font-semibold

          max-[480.001px]:[&_button]:flex-1">
        <Button type="button" variant="outline" onClick={props.onCancel}>
          Cancel
        </Button>
        <Button type="button" variant={props.danger ? 'destructive' : 'default'} disabled={!ok} onClick={props.onConfirm}>
          {props.confirmLabel}
        </Button>
      </div>
    </Modal>
  );
}

const QUICK = ['Wrong checkpoint', 'Wrong person', 'Test scan'] as const;

// F11: a reason (3–200 chars) is required; quick picks as in the scanner (§10.3).
export function VoidDialog(props: { what: string; onSubmit: (reason: string) => void; onCancel: () => void }) {
  const [other, setOther] = useState('');
  const valid = other.trim().length >= 3 && other.trim().length <= 200;
  return (
    <Modal title={`Void ${props.what}`} onCancel={props.onCancel}>
      <p>Why are you voiding it? The scan stays in the history, but it no longer counts.</p>
      <div className="grid gap-[14px] [&_>_.tw-admin-muted]:m-[-4px_0px_0px] [&_>_.tw-admin-muted]:text-[12px]

          [&_>_.tw-admin-muted]:leading-[1.6] [&_>_button]:min-h-[44px] [&_>_button]:p-[8px_12px]

          [&_>_button]:rounded-md [&_>_button]:[font-family:inherit] [&_>_button]:text-[12px]

          [&_>_button]:font-semibold">
        {QUICK.map((r) => (
          <Button key={r} type="button" variant="outline" onClick={() => props.onSubmit(r)}>
            {r}
          </Button>
        ))}
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground">
          Other reason
          <Input className="tw-admin-input w-full" value={other} maxLength={200} onChange={(e) => setOther(e.target.value)} />
        </Label>
        <Button type="button" disabled={!valid} onClick={() => props.onSubmit(other.trim())}>
          Void with this reason
        </Button>
      </div>
      <div className="flex gap-[8px] justify-end flex-wrap mt-[8px] pt-[14px] [border-top-width:1px] [border-top-style:solid]

          [border-top-color:var(--line)] [&_button]:min-h-[44px] [&_button]:p-[8px_12px] [&_button]:rounded-md

          [&_button]:[font-family:inherit] [&_button]:text-[12px] [&_button]:font-semibold

          max-[480.001px]:[&_button]:flex-1">
        <Button type="button" variant="outline" onClick={props.onCancel}>
          Keep the scan
        </Button>
      </div>
    </Modal>
  );
}
