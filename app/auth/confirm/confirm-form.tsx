'use client';

import { Button } from '@/components/ui/button';

import { useSyncExternalStore } from 'react';

const subscribe = (onChange: () => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};

// The link's token arrives in the URL fragment, which browsers never send to the server (like I-3).
// It leaves the page only in the POST that spends it.
export function ConfirmForm(props: { action: (form: FormData) => Promise<void>; type: string; next: string }) {
  const tokenHash = useSyncExternalStore(subscribe, () => window.location.hash.replace(/^#/, ''), () => '');
  return (
    <form action={props.action} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
      <input type="hidden" name="token_hash" value={tokenHash} />
      <input type="hidden" name="type" value={props.type} />
      <input type="hidden" name="next" value={props.next} />
      <Button type="submit" disabled={!tokenHash}>
        Continue
      </Button>
    </form>
  );
}
