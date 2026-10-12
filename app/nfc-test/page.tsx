import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { NfcTest } from './nfc-test';

export const metadata: Metadata = { title: 'NFC test · Passline', robots: { index: false, follow: false } };

// Development only: shows what Chrome's Web NFC actually delivers on this phone. Reads, never writes,
// touches no data. 404 in production builds.
export default function NfcTestPage() {
  if (process.env.NODE_ENV === 'production') notFound();
  return <NfcTest />;
}
