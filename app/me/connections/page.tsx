import { Entrance } from '@/components/motion';
import { Card } from '@/components/ui/card';
import type { Metadata } from 'next';
import Link from 'next/link';
import { db } from '@/lib/db/server';
import { myConnections } from '@/lib/me/connections';
import { loadMyEvent, menuMetadata } from '../load';
import { ConnectionList } from './list';

export const metadata: Metadata = menuMetadata('Connections');

// SPEC F16 (v0.12): all of the signed-in hacker's mutual connections. Who met whom is only ever shown to the
// two people involved.
export default async function ConnectionsPage() {
  const { me: m } = await loadMyEvent('/me/connections');
  const mine = await myConnections(db(), m.participantId, 1000);

  return (
    <Entrance><main className="max-w-[480px] lg:pointer-fine:max-w-[760px] m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0 [:where(&)_>_*]:mb-0">
      <div className="flex items-center justify-between gap-[16px] min-h-[44px] pb-[4px] mb-[8px] [border-bottom-width:1px] [border-bottom-style:solid] [border-bottom-color:var(--line)]">
        <Link className="inline-flex items-center min-h-[44px] text-fg font-semibold no-underline [&:hover]:text-accent" href="/me">
          ← Menu
        </Link>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-[12px] tracking-[0.08em] uppercase">{m.event.name}</span>
      </div>
      <h1>Connections</h1>
      <p className="m-0 text-muted-foreground text-[14px]">
        {mine.total} {mine.total === 1 ? 'connection' : 'connections'}.
        {mine.waitingOn > 0 && ` Waiting on ${mine.waitingOn} ${mine.waitingOn === 1 ? 'person' : 'people'} to tap you back.`}
      </p>
      <Card className="[&>p]:m-0">
        {mine.recent.length > 0 ? <ConnectionList people={mine.recent} /> : <p>No connections yet. Tap someone’s badge and press Connect.</p>}
      </Card>
    </main></Entrance>
  );
}
