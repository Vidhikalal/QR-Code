import { BrandMark } from '@/components/brand-mark';

import { Entrance } from '@/components/motion';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeNextPath } from '@/lib/auth/next-path';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';

export const metadata: Metadata = { title: 'Your name · Datathon', robots: { index: false } };

const nameSchema = z.string().trim().min(1).max(60);

// SPEC F9 step 2: the name other volunteers see ("ALREADY SCANNED 12:03 PM by Maya").
async function saveName(formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login');
  const next = safeNextPath(String(formData.get('next') ?? ''));
  const name = nameSchema.safeParse(formData.get('display_name'));
  if (!name.success) redirect(`/onboarding?invalid=1&next=${encodeURIComponent(next)}`);
  const { error } = await db().from('staff_profiles').upsert({ user_id: user.id, display_name: name.data });
  if (error) throw new Error(`staff_profiles upsert failed (${error.code})`);
  redirect(next);
}

export default async function OnboardingPage({ searchParams }: { searchParams: Promise<{ next?: string; invalid?: string }> }) {
  const user = await currentUser();
  const { next, invalid } = await searchParams;
  if (!user) redirect(`/login?next=${encodeURIComponent(safeNextPath(next))}`);
  return (
    <Entrance><main className="min-h-dvh justify-center max-w-[480px] lg:pointer-fine:max-w-[760px]  m-[0px_auto] p-[48px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
      <BrandMark />
      <h1>What should volunteers call you?</h1>
      <p className="copy">Other staff see this name next to your scans.</p>
      <form action={saveName} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
        <input type="hidden" name="next" value={safeNextPath(next)} />
        <Label htmlFor="display_name">Display name</Label>
        <Input id="display_name" name="display_name" required maxLength={60} className="min-h-12 w-full" autoComplete="nickname" />
        {invalid && (
          <Alert className="text-bad" asChild><p role="alert" >
            ✕ Enter a name between 1 and 60 characters.
          </p></Alert>
        )}
        <Button type="submit">Continue</Button>
      </form>
    </main></Entrance>
  );
}
