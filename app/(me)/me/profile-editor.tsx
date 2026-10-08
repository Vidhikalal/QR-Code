'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { PublicProfileCard } from '@/components/public-profile-card';
import { PHOTO_ERRORS, shrinkPhoto } from '@/lib/photo/shrink';
import type { PublicProfile } from '@/lib/profile/public';
import { profilePatchSchema, type BadgeRole } from '@/lib/profile/schema';
import styles from '../me.module.css';

type Editable = {
  nickname: string | null;
  pronouns: string | null;
  program: string | null;
  yearLabel: string | null;
  bio: string | null;
  linkedinUrl: string | null;
  githubUrl: string | null;
  websiteUrl: string | null;
  discordHandle: string | null;
  askMeAbout: readonly string[];
  visibility: 'public' | 'hidden';
};

export interface ProfileViewData {
  badgeRole: BadgeRole;
  canEditTopics: boolean;
  canEditDiscord: boolean;
  profile: Editable;
  hiddenByStaff: boolean;
  public: PublicProfile;
  photo: { url: string | null; locked: boolean };
}

const TEXT_FIELDS = [
  ['nickname', 'Nickname', 'What people call you. Shown instead of your name.', 40],
  ['pronouns', 'Pronouns', 'e.g. she/her', 30],
  ['program', 'Program', 'e.g. Computer Science', 80],
  ['yearLabel', 'Year', 'e.g. 3rd year', 30],
] as const;
const LINK_FIELDS = [
  ['linkedinUrl', 'LinkedIn', 'https://www.linkedin.com/in/your-name'],
  ['githubUrl', 'GitHub', 'https://github.com/your-name'],
  ['websiteUrl', 'Website', 'https://…'],
] as const;

type Form = { [K in Exclude<keyof Editable, 'askMeAbout' | 'visibility'>]: string } & { askMeAbout: string[]; visibility: 'public' | 'hidden' };

const toForm = (p: Editable): Form => ({
  nickname: p.nickname ?? '',
  pronouns: p.pronouns ?? '',
  program: p.program ?? '',
  yearLabel: p.yearLabel ?? '',
  bio: p.bio ?? '',
  linkedinUrl: p.linkedinUrl ?? '',
  githubUrl: p.githubUrl ?? '',
  websiteUrl: p.websiteUrl ?? '',
  discordHandle: p.discordHandle ?? '',
  askMeAbout: [...p.askMeAbout],
  visibility: p.visibility,
});

// PLAN §10.4: the owner's profile form. Validated live with the same schema the server uses.
export function ProfileEditor({ initial }: { initial: ProfileViewData }) {
  const [view, setView] = useState(initial);
  const [form, setForm] = useState<Form>(() => toForm(initial.profile));
  const [topic, setTopic] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);

  const schema = useMemo(() => profilePatchSchema({ badgeRole: view.badgeRole, extraRoles: view.canEditDiscord }), [view.badgeRole, view.canEditDiscord]);
  const body = useMemo(() => {
    const { askMeAbout, discordHandle, ...rest } = form;
    return { ...rest, ...(view.canEditTopics && { askMeAbout }), ...(view.canEditDiscord && { discordHandle }) };
  }, [form, view.canEditTopics, view.canEditDiscord]);
  const parsed = schema.safeParse(body);
  const errors = new Map<string, string>(parsed.success ? [] : parsed.error.issues.map((i) => [String(i.path[0]), i.message]));

  const set = (key: keyof Form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  async function save() {
    if (!parsed.success) return;
    setSaving(true);
    setMessage(null);
    const res = await fetch('/api/me/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      const next = (await res.json()) as ProfileViewData;
      setView(next);
      setForm(toForm(next.profile));
      setMessage({ ok: true, text: '✓ Saved.' });
    } else if (res?.status === 401) setMessage({ ok: false, text: '✕ You’ve been signed out. Open your newest profile link.' });
    else setMessage({ ok: false, text: '✕ Couldn’t save. Check the highlighted fields and try again.' });
  }

  function addTopic() {
    const t = topic.trim();
    if (!t || form.askMeAbout.includes(t) || form.askMeAbout.length >= 5) return;
    setForm((f) => ({ ...f, askMeAbout: [...f.askMeAbout, t] }));
    setTopic('');
  }

  async function uploadPhoto(file: File) {
    setMessage(null);
    let blob: Blob = file;
    try {
      blob = await shrinkPhoto(file);
    } catch {
      // Fall back to the original; the server validates it either way.
    }
    const data = new FormData();
    data.set('file', new File([blob], 'photo.jpg', { type: 'image/jpeg' }));
    const res = await fetch('/api/me/photo', { method: 'POST', body: data }).catch(() => null);
    if (!res?.ok) {
      setMessage({ ok: false, text: `✕ ${PHOTO_ERRORS[res?.status ?? 0] ?? 'Upload failed. Please try again.'}` });
      return;
    }
    const refreshed = await fetch('/api/me/profile').catch(() => null);
    if (refreshed?.ok) setView((await refreshed.json()) as ProfileViewData);
    setMessage({ ok: true, text: '✓ Photo saved.' });
  }

  const field = (key: keyof Form, label: string, hint: string, extra: { max?: number; type?: string } = {}) => {
    const id = `f-${key}`;
    const err = errors.get(key);
    return (
      <label className={styles.field} htmlFor={id} key={key}>
        {label}
        <input
          id={id}
          className={styles.input}
          type={extra.type ?? 'text'}
          value={form[key] as string}
          placeholder={hint}
          aria-invalid={err ? true : undefined}
          aria-describedby={err ? `${id}-err` : undefined}
          onChange={(e) => set(key, e.target.value)}
        />
        {err && (
          <span id={`${id}-err`} className={styles.fieldError}>
            ✕ {err}
          </span>
        )}
      </label>
    );
  };

  return (
    <>
      {view.hiddenByStaff && (
        <p className={styles.banner} role="note">
          <span aria-hidden="true">!</span>
          <span>An organizer has hidden your profile. Others only see your name. Contact the organizers if you think this is a mistake.</span>
        </p>
      )}
      <form
        className={styles.card}
        aria-labelledby="profile-heading"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <h2 id="profile-heading">Your profile</h2>
        {TEXT_FIELDS.map(([key, label, hint]) => field(key, label, hint))}
        <label className={styles.field} htmlFor="f-bio">
          Bio
          <textarea
            id="f-bio"
            className={styles.textarea}
            rows={4}
            value={form.bio}
            aria-invalid={errors.has('bio') ? true : undefined}
            aria-describedby="f-bio-count"
            onChange={(e) => set('bio', e.target.value)}
          />
          <span id="f-bio-count" className={errors.has('bio') ? styles.fieldError : styles.muted}>
            {[...form.bio.trim()].length}/280
          </span>
        </label>
        {LINK_FIELDS.map(([key, label, hint]) => field(key, label, hint, { type: 'url' }))}
        {view.canEditDiscord && field('discordHandle', 'Discord', 'your.handle')}
        {view.canEditTopics && (
          <fieldset className={styles.fieldset}>
            <legend>Ask me about… (up to 5)</legend>
            <ul className={styles.chips}>
              {form.askMeAbout.map((t) => (
                <li key={t}>
                  {t}{' '}
                  <button type="button" className={styles.chipRemove} aria-label={`Remove ${t}`} onClick={() => setForm((f) => ({ ...f, askMeAbout: f.askMeAbout.filter((x) => x !== t) }))}>
                    ×
                  </button>
                </li>
              ))}
            </ul>
            <div className={styles.actions}>
              <input
                className={styles.input}
                aria-label="New topic"
                maxLength={30}
                value={topic}
                onChange={(e) => setTopic(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    addTopic();
                  }
                }}
              />
              <button type="button" className={styles.secondary} disabled={form.askMeAbout.length >= 5} onClick={addTopic}>
                Add topic
              </button>
            </div>
          </fieldset>
        )}
        <fieldset className={styles.fieldset}>
          <legend>Who can see your profile</legend>
          <label className={styles.radio}>
            <input type="radio" name="visibility" checked={form.visibility === 'public'} onChange={() => set('visibility', 'public')} /> Public: anyone who taps your badge sees this
          </label>
          <label className={styles.radio}>
            <input type="radio" name="visibility" checked={form.visibility === 'hidden'} onChange={() => set('visibility', 'hidden')} /> Hidden: only your name
          </label>
        </fieldset>
        {message && (
          <p role="status" className={`${styles.alert} ${message.ok ? styles.alertOk : styles.alertBad}`}>
            {message.text}
          </p>
        )}
        <div className={styles.actions}>
          <button type="submit" disabled={saving || !parsed.success}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
        </div>
      </form>

      <section className={styles.card} aria-labelledby="preview-heading">
        <h2 id="preview-heading">How others see you</h2>
        <PublicProfileCard profile={view.public} privateNote="Hidden: others only see your name." />
      </section>

      <section className={styles.card} aria-labelledby="photo-heading">
        <h2 id="photo-heading">Check-in photo</h2>
        <p className={styles.muted}>Only organizers and volunteers see this, at check-in. It’s never on your public profile.</p>
        {view.photo.url && <Image src={view.photo.url} alt="Your check-in photo" width={160} height={160} unoptimized className={styles.photo} />}
        {view.photo.locked ? (
          <p className={styles.muted}>Locked: you’ve checked in, so your photo can’t change.</p>
        ) : (
          <label className={styles.field}>
            {view.photo.url ? 'Replace photo' : 'Add a photo'}
            <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(e) => e.target.files?.[0] && void uploadPhoto(e.target.files[0])} />
          </label>
        )}
      </section>
    </>
  );
}
