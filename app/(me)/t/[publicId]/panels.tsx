'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { SigninCodeDialog } from '@/components/signin-code-dialog';
import type { BadgeView } from '@/lib/badge/view';
import styles from './badge.module.css';

type Linked = Extract<BadgeView, { kind: 'linked' }>;
type StaffPanelData = NonNullable<Linked['staff']>;

interface AssignResult {
  code: string;
  holder?: { displayName: string };
  currentTag?: { label: string | null };
  participant?: { displayName: string };
}
interface SearchHit {
  id: string;
  displayName: string;
  status: string;
}

async function post<T>(url: string, body: unknown): Promise<{ status: number; data: T | null }> {
  const res = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
  return { status: res?.status ?? 0, data: res ? ((await res.json().catch(() => null)) as T | null) : null };
}

// PLAN F20 (iPhone door) / F23: link this blank badge to the person just admitted, or anyone found by search.
export function AssignPanel(props: {
  publicId: string;
  eventSlug: string;
  tagLabel: string | null;
  suggestion: { participantId: string; name: string; secondsAgo: number } | null;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<{ tone: 'ok' | 'bad' | 'warn'; text: string } | null>(null);
  const [replace, setReplace] = useState<{ participantId: string; name: string; current: string } | null>(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const badge = props.tagLabel ?? 'This badge';

  async function assign(participantId: string, name: string, withReplace = false) {
    setMessage(null);
    const r = await post<AssignResult>('/api/tags/assign', { eventSlug: props.eventSlug, participantId, tagPublicId: props.publicId, replace: withReplace });
    const code = r.data?.code;
    if (code === 'ASSIGNED' || code === 'ALREADY_ASSIGNED') {
      setMessage({ tone: 'ok', text: `✓ ${badge} linked to ${name}.` });
      setReplace(null);
      setTimeout(() => router.refresh(), 800);
    } else if (code === 'PARTICIPANT_HAS_TAG') setReplace({ participantId, name, current: r.data?.currentTag?.label ?? 'a badge' });
    else if (code === 'TAG_IN_USE') setMessage({ tone: 'bad', text: `✕ That badge belongs to ${r.data?.holder?.displayName ?? 'someone else'}: pick another.` });
    else if (code === 'TAG_RETIRED') setMessage({ tone: 'bad', text: '✕ This badge was deactivated: pick another.' });
    else if (code === 'NOT_ACCEPTED') setMessage({ tone: 'bad', text: `✕ ${name} isn’t accepted for this event.` });
    else if (r.status === 401) setMessage({ tone: 'bad', text: '✕ Your staff session expired. Sign in again.' });
    else setMessage({ tone: 'bad', text: `✕ Couldn’t link the badge (${code ?? r.status}).` });
  }

  async function search() {
    const res = await fetch(`/api/events/${encodeURIComponent(props.eventSlug)}/participants/search?q=${encodeURIComponent(q)}`).catch(() => null);
    if (res?.ok) setHits(((await res.json()) as { results: SearchHit[] }).results);
    else setMessage({ tone: 'warn', text: res?.status === 400 ? 'Type at least 2 letters.' : 'Search failed. Try again.' });
  }

  return (
    <section className={`${styles.card} ${styles.staff}`} aria-labelledby="assign-heading">
      <span className={styles.staffTag}>Staff</span>
      <h1 id="assign-heading">{badge} isn’t linked yet</h1>
      {props.suggestion ? (
        <button type="button" className={styles.big} onClick={() => void assign(props.suggestion!.participantId, props.suggestion!.name)}>
          Assign to {props.suggestion.name} (admitted by you {props.suggestion.secondsAgo} s ago)
        </button>
      ) : (
        <p className={styles.muted}>Admit someone at the door first, or find them below.</p>
      )}
      {replace && (
        <div className={`${styles.alert} ${styles.alertWarn}`} role="alertdialog" aria-label="Replace their badge?">
          <p style={{ margin: 0 }}>
            ! {replace.name} already has {replace.current}. Replace it? Their old badge stops working.
          </p>
          <div className={styles.actions}>
            <button type="button" className={styles.danger} onClick={() => void assign(replace.participantId, replace.name, true)}>
              Replace it
            </button>
            <button type="button" className={styles.secondary} onClick={() => setReplace(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <form
        style={{ marginTop: 16 }}
        onSubmit={(e) => {
          e.preventDefault();
          void search();
        }}
      >
        <label>
          Find someone
          <input className={styles.input} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Name" />
        </label>
        <div className={styles.actions}>
          <button type="submit" className={styles.secondary}>
            Search
          </button>
        </div>
      </form>
      {hits && (
        <ul className={styles.results} aria-label="Search results">
          {hits.length === 0 && <li>No one found.</li>}
          {hits.map((h) => (
            <li key={h.id}>
              <span>
                {h.displayName} <span className={styles.muted}>({h.status})</span>
              </span>
              <button type="button" className={styles.secondary} aria-label={`Assign to ${h.displayName}`} onClick={() => void assign(h.id, h.displayName)}>
                Assign
              </button>
            </li>
          ))}
        </ul>
      )}
      {message && (
        <p role="status" className={`${styles.alert} ${message.tone === 'ok' ? styles.alertOk : message.tone === 'warn' ? styles.alertWarn : styles.alertBad}`}>
          {message.text}
        </p>
      )}
    </section>
  );
}

// PLAN §8.2 staff panel (V4b part): who wears this badge, plus unlink, sign-in code and hide profile.
export function StaffPanel({ panel }: { panel: StaffPanelData }) {
  const router = useRouter();
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showCode, setShowCode] = useState(false);
  const h = panel.holder;
  const name = h?.fullName ?? 'This person';

  async function unlink() {
    if (!panel.assignment) return;
    const r = await post<{ code: string }>('/api/tags/unassign', { assignmentId: panel.assignment.id });
    if (r.data?.code === 'UNASSIGNED') {
      setMessage({ ok: true, text: `✓ Unlinked. ${panel.label ?? 'The badge'} can be linked again.` });
      setTimeout(() => router.refresh(), 800);
    } else setMessage({ ok: false, text: `✕ Couldn’t unlink (${r.data?.code ?? r.status}).` });
  }

  async function setHidden(hidden: boolean) {
    if (!panel.participantId) return;
    const r = await post<{ code: string }>(`/api/admin/${encodeURIComponent(panel.eventSlug)}/participants/${panel.participantId}/hide-profile`, { hidden });
    if (r.status === 200) router.refresh();
    else setMessage({ ok: false, text: '✕ Couldn’t change the profile visibility.' });
  }

  return (
    <section className={`${styles.card} ${styles.staff}`} aria-label="Staff panel">
      <span className={styles.staffTag}>Staff</span>
      <div className={styles.holder}>
        {h?.photoUrl ? (
          <Image className={styles.photo} src={h.photoUrl} alt={`Photo of ${name}`} width={160} height={160} unoptimized />
        ) : (
          <div className={styles.photo} role="img" aria-label="No photo" />
        )}
        <div>
          <div className={styles.name}>{name}</div>
          <div className={styles.muted}>
            {h?.badgeRole} · {h?.status} · {panel.label ?? 'no label'}
          </div>
        </div>
      </div>
      {panel.hiddenBy && <p className={styles.note}>Profile hidden by {panel.hiddenBy === 'staff' ? 'an organizer' : 'its owner'}.</p>}
      <div className={styles.actions}>
        {panel.participantId && (
          <button type="button" className={styles.secondary} onClick={() => setShowCode(true)}>
            Show sign-in code
          </button>
        )}
        {panel.role === 'organizer' && panel.participantId && (
          <button type="button" className={styles.secondary} onClick={() => void setHidden(panel.hiddenBy !== 'staff')}>
            {panel.hiddenBy === 'staff' ? 'Show profile' : 'Hide profile'}
          </button>
        )}
        {panel.assignment?.canUnlink && (
          <button type="button" className={styles.danger} onClick={() => void unlink()}>
            Unlink badge
          </button>
        )}
      </div>
      {message && (
        <p role="status" className={`${styles.alert} ${message.ok ? styles.alertOk : styles.alertBad}`}>
          {message.text}
        </p>
      )}
      {showCode && panel.participantId && <SigninCodeDialog participantId={panel.participantId} name={name} onClose={() => setShowCode(false)} />}
    </section>
  );
}

// The owner's own badge: edit the profile, or sign out of this device.
export function OwnerActions() {
  const router = useRouter();
  return (
    <div className={styles.actions}>
      <a className="button" href="/me">
        Edit my profile
      </a>
      <button
        type="button"
        className={styles.secondary}
        onClick={() => void fetch('/api/me/session', { method: 'DELETE' }).finally(() => router.refresh())}
      >
        Sign out
      </button>
    </div>
  );
}
