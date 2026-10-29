import type { Metadata } from 'next';
import { RsvpView } from './rsvp-view';

// SPEC F13. The RSVP token lives only in the URL fragment, which browsers never send to the server (I-3).
export const metadata: Metadata = {
  title: 'Your invitation · Datathon',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

export default function RsvpPage() {
  return <RsvpView />;
}
