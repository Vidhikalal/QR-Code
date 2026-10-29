
import { Entrance } from '@/components/motion';
import type { Metadata } from 'next';
import { forbidden, redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { requireStaffBySlug } from '@/lib/auth/staff';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { AdminNav } from './nav';

export const metadata: Metadata = { title: 'Admin · Datathon', robots: { index: false } };

// SPEC §3 / §11: organizer only, checked server-side before anything about the event is read (I-5).
// forbidden() answers with HTTP 403 (T-ADM-01). Every API the pages call re-checks on its own.
export default async function AdminLayout({ children, params }: { children: ReactNode; params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(`/admin/${slug}`)}`);
  const staff = await requireStaffBySlug(db(), user.id, slug, 'organizer');
  if (!staff) forbidden();
  const { data: event, error } = await db().from('events').select('name').eq('id', staff.eventId).single();
  if (error) throw new Error(`event load failed (${error.code})`);
  return (
    <div className="min-h-[100dvh]

          [background:radial-gradient(_ellipse_at_50%_0%,_color-mix(in_srgb,_var(--accent)_5%,_transparent),_transparent_55%_),_var(--bg)]">
      <header className="sticky top-0 z-[5] [background:color-mix(in_srgb,_var(--bg-deep)_90%,_transparent)]

          [border-bottom-width:1px] [border-bottom-style:solid]

          [border-bottom-color:color-mix(in_srgb,_var(--accent)_20%,_var(--line))] p-[8px_16px_0px]

          [backdrop-filter:blur(16px)] max-[600.001px]:[padding-inline:12px]">
        <div className="max-w-[1500px] m-[0px_auto] p-[14px_0px_12px] w-full box-border [margin-inline:auto]

          [padding-inline:clamp(16px,_3vw,_44px)] max-[600.001px]:p-[12px_0px]

          max-[600.001px]:[padding-inline:2px]">
          <div className="flex items-center gap-[9px] mb-[10px] max-[600.001px]:mb-[8px]">
            <span className="grid [place-items:center] w-[25px] h-[25px] [border-width:1px] [border-style:solid]

          [border-top-color:color-mix(in_srgb,_var(--accent)_50%,_transparent)]

          [border-right-color:color-mix(in_srgb,_var(--accent)_50%,_transparent)]

          [border-bottom-color:color-mix(in_srgb,_var(--accent)_50%,_transparent)]

          [border-left-color:color-mix(in_srgb,_var(--accent)_50%,_transparent)] rounded-md text-accent

          [background:color-mix(in_srgb,_var(--accent)_8%,_var(--card))] text-[11px] font-bold">D/</span>
            <span className="text-[10px] font-bold tracking-[0.13em] text-fg">DATATHON</span>
            <span className="w-[1px] h-[14px] [background:var(--line)]" aria-hidden="true" />
            <span className="text-[10px] font-bold tracking-[0.13em] text-muted-foreground">EVENT CONSOLE</span>
          </div>
          <div className="tw-admin-eventName flex items-center gap-[10px] text-[clamp(19px,_2.5vw,_25px)] tracking-[-0.035em]

          leading-[1.2]">{event.name}</div>
        </div>
        <AdminNav slug={slug} />
      </header>
      <Entrance><main className="tw-admin-main w-full max-w-[1500px] [margin-inline:auto] p-[clamp(24px,_3vw,_44px)] box-border

          max-[600.001px]:p-[22px_14px_32px] [:where(&)_h1]:m-[0px_0px_28px]

          [&&_h1]:text-[clamp(32px,_2.8vw,_42px)] [:where(&)_h1]:leading-[1.1] [:where(&)_h1]:tracking-[-0.05em]

          [:where(&)_h1]:font-bold [:where(&)_h2]:flex [:where(&)_h2]:items-center [:where(&)_h2]:gap-[10px]

          [:where(&)_h2]:m-[36px_0px_14px] [&&_h2]:text-[20px] [:where(&)_h2]:leading-[1.3]

          [:where(&)_h2]:tracking-[-0.025em] [:where(&)_h2]:font-semibold

          max-[600.001px]:[:where(&)_h2]:m-[28px_0px_14px] [&_>_h1]:relative [&_>_h1]:mb-[28px]
          [&_>_h1]:pb-[18px]
 [&_>_h1]:[border-bottom-width:1px] [&_>_h1]:[border-bottom-style:solid]

          [&_>_h1]:[border-bottom-color:var(--line)] max-[600.001px]:[&_>_h1]:mb-[22px]

          max-[600.001px]:[&_>_h1]:pb-[14px] [&_>_h2]:mt-[38px] max-[600.001px]:[&_>_h2]:mt-[30px]

          [&_>_.tw-admin-muted]:mt-[24px] [&_>_.tw-admin-muted]:pt-[14px]

          [&_>_.tw-admin-muted]:[border-top-width:1px] [&_>_.tw-admin-muted]:[border-top-style:solid]

          [&_>_.tw-admin-muted]:[border-top-color:var(--line)]

          [&_button:focus-visible]:[outline:2px_solid_var(--accent)]
          [&_button:focus-visible]:[outline-offset:3px]
 [&_a:focus-visible]:[outline:2px_solid_var(--accent)]
          [&_a:focus-visible]:[outline-offset:3px]
 [&_input:focus-visible]:[outline:2px_solid_var(--accent)]
          [&_input:focus-visible]:[outline-offset:3px]
 [&_select:focus-visible]:[outline:2px_solid_var(--accent)]
          [&_select:focus-visible]:[outline-offset:3px]

          [&_textarea:focus-visible]:[outline:2px_solid_var(--accent)]

          [&_textarea:focus-visible]:[outline-offset:3px]">{children}</main></Entrance>
    </div>
  );
}
