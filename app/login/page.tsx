
import { Entrance } from '@/components/motion';
import { Alert } from '@/components/ui/alert';
import type { Metadata } from 'next';
import { safeNextPath } from '@/lib/auth/next-path';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Sign in · Datathon', robots: { index: false } };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; error?: string }> }) {
  const { next, error } = await searchParams;
  const target = safeNextPath(next, '/me');
  return (
    <Entrance><main className="min-h-dvh justify-center max-w-[480px] lg:pointer-fine:max-w-[760px]  m-[0px_auto] p-[48px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
      <h1>{target.startsWith('/scan/') || target.startsWith('/admin/') ? 'Staff sign-in' : 'Sign in'}</h1>
      <p>Use the email and password you set from your Datathon invitation.</p>
      {error && (
        <Alert className="text-bad" asChild><p role="alert" >
          ✕ That link didn&apos;t work or has expired. Use &quot;Forgot or never set your password?&quot; to get a new one.
        </p></Alert>
      )}
      <LoginForm next={target} />
    </main></Entrance>
  );
}
