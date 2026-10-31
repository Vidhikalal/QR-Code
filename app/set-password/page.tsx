import { BrandMark } from '@/components/brand-mark';

import { Entrance } from '@/components/motion';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeNextPath } from '@/lib/auth/next-path';
import { landingAfterSignIn } from '@/lib/auth/onboarding';
import { currentUser, supabaseForRequest } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { env } from '@/lib/env';

export const metadata: Metadata = { title: 'Set your password · Datathon', robots: { index: false } };

// 72: bcrypt ignores anything longer, and the auth server rejects it.
const passwordSchema = z.string().min(8).max(72);

// SPEC F9/F13 (v0.4): after an invite, reset or RSVP link, the signed-in person picks their password.
async function savePassword(formData: FormData) {
  'use server';
  const next = safeNextPath(String(formData.get('next') ?? ''), '/me');
  const retry = `/set-password?invalid=1&next=${encodeURIComponent(next)}`;
  const password = passwordSchema.safeParse(formData.get('password'));
  if (!password.success) redirect(retry);
  const { data, error } = await (await supabaseForRequest()).auth.updateUser({ password: password.data });
  if (error?.code === 'weak_password') redirect(retry);
  // Choosing the password you already have is fine (e.g. "Forgot password" when you hadn't).
  if (error && error.code !== 'same_password') {
    if (error.status === 401 || error.code === 'session_not_found') redirect(`/login?next=${encodeURIComponent(next)}`);
    throw new Error(`updateUser failed (${error.code ?? error.status})`);
  }
  const user = data.user ?? (await currentUser());
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  redirect(await landingAfterSignIn(db(), user, next, env().ADMIN_EMAILS));
}

export default async function SetPasswordPage({ searchParams }: { searchParams: Promise<{ next?: string; invalid?: string }> }) {
  const { next, invalid } = await searchParams;
  const target = safeNextPath(next, '/me');
  const user = await currentUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(target)}`);
  return (
    <Entrance><main className="min-h-dvh justify-center max-w-[480px] lg:pointer-fine:max-w-[760px]  m-[0px_auto] p-[48px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
      <BrandMark />
      <h1>Set your password</h1>
      <form action={savePassword} className="grid gap-[16px] [&_label_+_:is(input,_select,_textarea)]:mt-[-10px] [&_label]:text-[14px]

          [&_label]:font-medium [&_h2]:m-[12px_0px_-8px] [&_h2]:pt-[16px] [&_h2]:[border-top-width:1px]

          [&_h2]:[border-top-style:solid] [&_h2]:[border-top-color:var(--line)] [&_h2]:text-[18px]

          [&_h2:first-of-type]:mt-0 [&_h2:first-of-type]:pt-0 [&_h2:first-of-type]:[border-top:0px]">
        <input type="hidden" name="next" value={target} />
        {/* Lets password managers save the new password against the right account. */}
        <Input type="email" name="username" autoComplete="username" value={user.email ?? ''} readOnly hidden />
        <Label htmlFor="password">New password</Label>
        <Input id="password" name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className="min-h-12 w-full" />
        {invalid && (
          <Alert className="text-bad" asChild><p role="alert" >
            ✕ Use 8 to 72 characters.
          </p></Alert>
        )}
        <Button type="submit">Save password</Button>
      </form>
    </main></Entrance>
  );
}
