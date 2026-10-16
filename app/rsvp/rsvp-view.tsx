'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { formatEventDateTime } from '@/lib/domain/event-time';
import form from '../login/login.module.css';
import styles from '../profile/[uid]/profile.module.css';

interface Invite {
  firstName: string;
  event: { name: string; venue: string; startsAt: string; timezone: string };
  status: string;
  hasAccount: boolean;
}

type View =
  | { kind: 'loading' | 'not_found' | 'rate_limited' | 'error' | 'not_going' | 'going' }
  | { kind: 'invite'; invite: Invite; askPassword: boolean };

function readToken(): string {
  try {
    return decodeURIComponent(window.location.hash.replace(/^#/, '')).trim();
  } catch {
    return ''; // malformed %-escapes
  }
}

async function post(body: object): Promise<{ status: number; data: Record<string, unknown> }> {
  try {
    const res = await fetch('/api/rsvp', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, data: ((await res.json().catch(() => ({}))) ?? {}) as Record<string, unknown> };
  } catch {
    return { status: 0, data: {} };
  }
}

// SPEC F13: answer the invitation. Yes without an account asks for a password first, then signs in
// and goes to /me; the pass is also emailed. No withdraws (they can change their mind until the event ends).
export function RsvpView() {
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'loading' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const token = readToken();
    void (token ? post({ token }) : Promise.resolve({ status: 404, data: {} })).then((r) =>
      setView(
        r.status === 200
          ? { kind: 'invite', invite: r.data as unknown as Invite, askPassword: false }
          : { kind: r.status === 404 ? 'not_found' : r.status === 429 ? 'rate_limited' : 'error' },
      ),
    );
  }, []);

  async function respond(going: boolean, password?: string) {
    setBusy(true);
    setError(null);
    const r = await post({ token: readToken(), going, ...(password !== undefined && { password }) });
    setBusy(false);
    if (r.status === 400 && r.data.error === 'weak_password') return setError('Use 8 to 72 characters.');
    if (r.status === 404) return setView({ kind: 'not_found' });
    if (r.status !== 200) return setError(r.status === 429 ? 'Too many tries. Wait a minute and try again.' : 'Something went wrong. Try again.');
    if (r.data.code === 'NOT_GOING') return setView({ kind: 'not_going' });
    if (r.data.signedIn === true) return router.push('/me');
    setView({ kind: 'going' });
  }

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.eyebrow}>Invitation</p>
        {view.kind === 'loading' && <p role="status">Loading…</p>}
        {view.kind === 'not_found' && (
          <>
            <h1>This invitation link doesn’t work</h1>
            <p>It may have been replaced by a newer email, or the event is over.</p>
          </>
        )}
        {(view.kind === 'rate_limited' || view.kind === 'error') && (
          <>
            <h1>Couldn’t load your invitation</h1>
            <p>{view.kind === 'rate_limited' ? 'Too many tries. Wait a minute, then reload.' : 'Check your connection, then reload.'}</p>
          </>
        )}
        {view.kind === 'going' && (
          <>
            <h1>You’re going</h1>
            <p>We’re emailing your check-in pass. You can also see it on Passline.</p>
            <p style={{ marginTop: 16 }}>
              <a className={styles.link} href="/login?next=%2Fme">
                Sign in to see your pass
              </a>
            </p>
          </>
        )}
        {view.kind === 'not_going' && (
          <>
            <h1>Thanks for letting us know</h1>
            <p>Changed your mind? Open the invitation link again before the event.</p>
          </>
        )}
        {view.kind === 'invite' && (
          <>
            <h1>{view.invite.event.name}</h1>
            <p>
              {formatEventDateTime(view.invite.event.startsAt, view.invite.event.timezone)} · {view.invite.event.venue}
            </p>
            <p style={{ marginTop: 12 }}>
              Hi {view.invite.firstName}, will you be there?
              {view.invite.status === 'accepted' && ' (You said yes.)'}
              {view.invite.status === 'withdrawn' && ' (You said no. You can still change your mind.)'}
            </p>
            {view.askPassword ? (
              <form
                className={form.form}
                onSubmit={(e) => {
                  e.preventDefault();
                  void respond(true, String(new FormData(e.currentTarget).get('password') ?? ''));
                }}
              >
                <label htmlFor="password">Set a password for your Passline account</label>
                <input id="password" name="password" type="password" required minLength={8} maxLength={72} autoComplete="new-password" className={form.input} />
                <button type="submit" disabled={busy}>
                  {busy ? 'Saving…' : 'Yes, I’ll be there'}
                </button>
              </form>
            ) : (
              <div className={form.form}>
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => (view.invite.hasAccount ? void respond(true) : setView({ ...view, askPassword: true }))}
                >
                  Yes, I’ll be there
                </button>
                <button type="button" className={form.linkButton} disabled={busy} onClick={() => void respond(false)}>
                  No, I can’t make it
                </button>
              </div>
            )}
            {error && (
              <p role="alert" className={form.error}>
                ✕ {error}
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}
