import type { Metadata } from 'next';
import { EditLink } from './edit-link';

// PLAN F17. The edit key lives only in the URL fragment, which browsers never send (I-18). This page
// is static and never writes on GET (I-17): the key is exchanged by an explicit POST from the client.
export const metadata: Metadata = {
  title: 'Signing you in · Passline',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function EditPage() {
  return <EditLink />;
}
