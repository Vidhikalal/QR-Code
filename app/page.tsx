import { redirect } from 'next/navigation';

// Signed-out visitors go on to /login (proxy.ts); signed-in people see their passes.
export default function HomePage() {
  redirect('/me');
}
