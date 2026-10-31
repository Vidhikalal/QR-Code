import { BrandMark } from '@/components/brand-mark';

import { Entrance } from '@/components/motion';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { safeNextPath } from '@/lib/auth/next-path';
import { supabaseForRequest } from '@/lib/auth/session';
import { ConfirmForm } from './confirm-form';

export const metadata: Metadata = { title: 'Set your password · Datathon', referrer: 'no-referrer', robots: { index: false } };

const linkSchema = z.object({ token_hash: z.string().min(1).max(200), type: z.enum(['invite', 'recovery']) });

// SPEC F9 (v0.4): invite and password-reset emails link here, with the token in the fragment. It is used
// up only when the person presses the button (a POST), so mail scanners that open links can't spend it.
async function confirm(formData: FormData) {
  'use server';
  const next = safeNextPath(String(formData.get('next') ?? ''), '/me');
  const link = linkSchema.safeParse({ token_hash: formData.get('token_hash'), type: formData.get('type') });
  const { error } = link.success
    ? await (await supabaseForRequest()).auth.verifyOtp(link.data)
    : { error: new Error('invalid link') };
  redirect(error ? `/login?error=link&next=${encodeURIComponent(next)}` : `/set-password?next=${encodeURIComponent(next)}`);
}

export default async function ConfirmPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { type = '', next } = await searchParams;
  return (
    <Entrance><main className="min-h-dvh justify-center max-w-[480px] lg:pointer-fine:max-w-[760px]  m-[0px_auto] p-[48px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
      <BrandMark />
      <h1>Set your Datathon password</h1>
      <ConfirmForm action={confirm} type={type} next={safeNextPath(next, '/me')} />
    </main></Entrance>
  );
}
