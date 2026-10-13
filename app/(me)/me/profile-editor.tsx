'use client';

import Image from 'next/image';
import { useMemo, useState } from 'react';
import { LOOKING_FOR_LABEL } from '@/components/public-profile-card';
import { PHOTO_ERRORS, shrinkPhoto } from '@/lib/photo/shrink';
import type { PublicProfile } from '@/lib/profile/public';
import { LOOKING_FOR, profilePatchSchema, type BadgeRole, type PublicField } from '@/lib/profile/schema';
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
  skills: readonly string[];
  lookingFor: readonly string[];
  dietaryNotes: string | null;
  accessibilityNotes: string | null;
  publicFields: readonly PublicField[];
  visibility: 'public' | 'hidden';
};

export interface ProfileViewData {
  firstName: string;
  badgeRole: BadgeRole;
  canEditDiscord: boolean;
  profile: Editable;
  hiddenByStaff: boolean;
  public: PublicProfile;
  photo: { url: string | null; locked: boolean };
}

type TextKey = 'nickname' | 'pronouns' | 'program' | 'yearLabel' | 'bio' | 'discordHandle' | 'dietaryNotes' | 'accessibilityNotes';
type Row =
  | { id: string; label: string; kind: 'text' | 'textarea'; key: TextKey; max: number; hint: string; vis: PublicField | null }
  | { id: 'links'; label: string; kind: 'links'; vis: PublicField }
  | { id: 'skills'; label: string; kind: 'skills'; vis: PublicField }
  | { id: 'lookingFor'; label: string; kind: 'lookingFor'; vis: PublicField };

const LINKS = [
  ['linkedinUrl', 'LinkedIn', 'https://www.linkedin.com/in/your-name'],
  ['githubUrl', 'GitHub', 'https://github.com/your-name'],
  ['websiteUrl', 'Website', 'https://…'],
] as const;

function rowsFor(canEditDiscord: boolean): Row[] {
  return [
    { id: 'nickname', label: 'Nickname', kind: 'text', key: 'nickname', max: 40, hint: 'What people call you. Shown instead of your name.', vis: null },
    { id: 'pronouns', label: 'Pronouns', kind: 'text', key: 'pronouns', max: 30, hint: 'e.g. she/her', vis: 'pronouns' },
    { id: 'program', label: 'Program', kind: 'text', key: 'program', max: 80, hint: 'e.g. Computer Science', vis: 'program' },
    { id: 'yearLabel', label: 'Year', kind: 'text', key: 'yearLabel', max: 30, hint: 'e.g. 3rd year', vis: 'year' },
    { id: 'bio', label: 'Bio', kind: 'textarea', key: 'bio', max: 280, hint: 'A sentence or two about you.', vis: 'bio' },
    { id: 'skills', label: 'What I’m good at', kind: 'skills', vis: 'skills' },
    { id: 'lookingFor', label: 'Looking for', kind: 'lookingFor', vis: 'lookingFor' },
    { id: 'links', label: 'Links', kind: 'links', vis: 'links' },
    ...(canEditDiscord ? [{ id: 'discordHandle', label: 'Discord', kind: 'text', key: 'discordHandle', max: 32, hint: 'your.handle', vis: 'discord' } as const] : []),
    { id: 'dietaryNotes', label: 'Dietary restrictions', kind: 'textarea', key: 'dietaryNotes', max: 500, hint: 'e.g. vegetarian, nut allergy', vis: 'dietary' },
    { id: 'accessibilityNotes', label: 'Accessibility / health needs', kind: 'textarea', key: 'accessibilityNotes', max: 500, hint: 'Anything organizers should know', vis: 'accessibility' },
  ];
}

const HEALTH_FIELDS: readonly PublicField[] = ['dietary', 'accessibility'];

// The profile page (profiles 2026-10-13): "How others see you" IS the editor. Tap a line to edit it;
// each line's switch decides whether other participants see it. Organizers always see everything.
// Every save is one PATCH validated with the same schema the server uses.
export function ProfileEditor({ initial }: { initial: ProfileViewData }) {
  const [view, setView] = useState(initial);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [skill, setSkill] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const p = view.profile;
  const schema = useMemo(() => profilePatchSchema({ badgeRole: view.badgeRole, extraRoles: view.canEditDiscord }), [view.badgeRole, view.canEditDiscord]);
  const rows = useMemo(() => rowsFor(view.canEditDiscord), [view.canEditDiscord]);

  const parsed = editing ? schema.safeParse(draft) : null;
  const errors = new Map<string, string>(parsed && !parsed.success ? parsed.error.issues.map((i) => [String(i.path[0]), i.message]) : []);

  async function patch(body: Record<string, unknown>, done: string): Promise<boolean> {
    setSaving(true);
    setMessage(null);
    const res = await fetch('/api/me/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      setView((await res.json()) as ProfileViewData);
      setMessage({ ok: true, text: `✓ ${done}` });
      return true;
    }
    setMessage({ ok: false, text: res?.status === 401 ? '✕ You’ve been signed out. Open your newest profile link.' : '✕ Couldn’t save. Check the field and try again.' });
    return false;
  }

  function startEdit(row: Row) {
    setMessage(null);
    setSkill('');
    setEditing(row.id);
    if (row.kind === 'text' || row.kind === 'textarea') setDraft({ [row.key]: p[row.key] ?? '' });
    else if (row.kind === 'links') setDraft({ linkedinUrl: p.linkedinUrl ?? '', githubUrl: p.githubUrl ?? '', websiteUrl: p.websiteUrl ?? '' });
    else if (row.kind === 'skills') setDraft({ skills: [...p.skills] });
    else setDraft({ lookingFor: [...p.lookingFor] });
  }

  async function saveEdit(row: Row) {
    if (!parsed?.success) return;
    // Close only this row's editor: another row may have been opened while the save was in flight.
    if (await patch(draft, `${row.label} saved.`)) setEditing((current) => (current === row.id ? null : current));
  }

  // Optimistic: the switch moves at once; a failed save puts it back.
  async function setHidden(hide: boolean) {
    const before = view;
    setView({ ...view, profile: { ...view.profile, visibility: hide ? 'hidden' : 'public' } });
    const ok = await patch({ visibility: hide ? 'hidden' : 'public' }, hide ? 'Your profile is hidden: others only see your name.' : 'Your profile is visible again.');
    if (!ok) setView(before);
  }

  const isPublic = (f: PublicField) => p.publicFields.includes(f);
  function toggle(f: PublicField, label: string) {
    const next = isPublic(f) ? p.publicFields.filter((x) => x !== f) : [...p.publicFields, f];
    void patch({ publicFields: next }, isPublic(f) ? `${label}: only organizers can see this now.` : `${label}: other participants can see this now.`);
  }

  function addSkill() {
    const t = skill.trim();
    const list = (draft.skills as string[] | undefined) ?? [];
    if (!t || list.includes(t) || list.length >= 5) return;
    setDraft({ skills: [...list, t] });
    setSkill('');
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

  const valueOf = (row: Row): string | null => {
    if (row.kind === 'text' || row.kind === 'textarea') return p[row.key];
    if (row.kind === 'skills') return p.skills.length ? p.skills.join(' · ') : null;
    if (row.kind === 'lookingFor') return p.lookingFor.length ? p.lookingFor.map((x) => LOOKING_FOR_LABEL[x] ?? x).join(', ') : null;
    const links = LINKS.filter(([k]) => p[k]).map(([, label]) => label);
    return links.length ? links.join(' · ') : null;
  };

  const editor = (row: Row) => {
    if (row.kind === 'text' || row.kind === 'textarea') {
      const id = `f-${row.key}`;
      const err = errors.get(row.key);
      const value = String(draft[row.key] ?? '');
      return (
        <label className={styles.field} htmlFor={id}>
          {row.label}
          {row.kind === 'textarea' ? (
            <textarea id={id} className={styles.textarea} rows={3} value={value} placeholder={row.hint} aria-invalid={err ? true : undefined} onChange={(e) => setDraft({ [row.key]: e.target.value })} autoFocus />
          ) : (
            <input id={id} className={styles.input} value={value} placeholder={row.hint} aria-invalid={err ? true : undefined} onChange={(e) => setDraft({ [row.key]: e.target.value })} autoFocus />
          )}
          <span className={err ? styles.fieldError : styles.muted}>{err ? `✕ ${err}` : `${[...value.trim()].length}/${row.max}`}</span>
        </label>
      );
    }
    if (row.kind === 'links') {
      return LINKS.map(([key, label, hint]) => {
        const err = errors.get(key);
        return (
          <label className={styles.field} htmlFor={`f-${key}`} key={key}>
            {label}
            <input id={`f-${key}`} type="url" className={styles.input} value={String(draft[key] ?? '')} placeholder={hint} aria-invalid={err ? true : undefined} onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))} />
            {err && <span className={styles.fieldError}>✕ {err}</span>}
          </label>
        );
      });
    }
    if (row.kind === 'skills') {
      const list = (draft.skills as string[] | undefined) ?? [];
      return (
        <>
          <ul className={styles.chips}>
            {list.map((t) => (
              <li key={t}>
                {t}{' '}
                <button type="button" className={styles.chipRemove} aria-label={`Remove ${t}`} onClick={() => setDraft({ skills: list.filter((x) => x !== t) })}>
                  ×
                </button>
              </li>
            ))}
          </ul>
          <div className={styles.actions}>
            <input
              className={styles.input}
              aria-label="New skill"
              placeholder="e.g. React, design, pitching"
              maxLength={30}
              value={skill}
              onChange={(e) => setSkill(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addSkill();
                }
              }}
            />
            <button type="button" className={styles.secondary} disabled={list.length >= 5} onClick={addSkill}>
              Add skill
            </button>
          </div>
          <span className={styles.muted}>Up to 5.</span>
        </>
      );
    }
    const chosen = (draft.lookingFor as string[] | undefined) ?? [];
    return (
      <fieldset className={styles.fieldset}>
        <legend>Looking for</legend>
        {LOOKING_FOR.map((x) => (
          <label className={styles.radio} key={x}>
            <input type="checkbox" checked={chosen.includes(x)} onChange={(e) => setDraft({ lookingFor: e.target.checked ? [...chosen, x] : chosen.filter((y) => y !== x) })} />{' '}
            {LOOKING_FOR_LABEL[x]}
          </label>
        ))}
      </fieldset>
    );
  };

  const hidden = p.visibility === 'hidden' || view.hiddenByStaff;
  return (
    <>
      {view.hiddenByStaff && (
        <p className={styles.banner} role="note">
          <span aria-hidden="true">!</span>
          <span>An organizer has hidden your profile. Others only see your name. Contact the organizers if you think this is a mistake.</span>
        </p>
      )}
      <section className={styles.card} aria-labelledby="preview-heading">
        <h2 id="preview-heading">How others see you</h2>
        <p className={styles.muted}>
          Tap a line to edit it. 👁 Visible to other participants · 🔒 Organizers only. Organizers can always see everything.
        </p>
        <label className={styles.radio}>
          <input type="checkbox" checked={p.visibility === 'hidden'} disabled={saving} onChange={(e) => void setHidden(e.target.checked)} />
          Hide my whole profile (others only see my name)
        </label>
        <article className={`${styles.profileCard} ${hidden ? styles.dim : ''}`} aria-label={`Profile of ${view.public.displayName}`}>
          <p className={styles.eyebrow}>{view.public.eventName}</p>
          <h3 className={styles.profileName}>{view.public.displayName}</h3>
          {view.public.label && <span className={styles.label}>{view.public.label}</span>}
          {hidden && <p className={styles.muted}>Hidden: others only see your name.</p>}
          <ul className={styles.rows}>
            {rows.map((row) => {
              const value = valueOf(row);
              const pub = row.vis === null || isPublic(row.vis);
              return (
                <li key={row.id} className={`${styles.row} ${pub ? '' : styles.rowPrivate}`} data-testid={`row-${row.id}`}>
                  {editing === row.id ? (
                    <form
                      onSubmit={(e) => {
                        e.preventDefault();
                        void saveEdit(row);
                      }}
                    >
                      {editor(row)}
                      <div className={styles.actions}>
                        <button type="submit" disabled={saving || !parsed?.success}>
                          {saving ? 'Saving…' : 'Save'}
                        </button>
                        <button type="button" className={styles.secondary} onClick={() => setEditing(null)}>
                          Cancel
                        </button>
                      </div>
                    </form>
                  ) : (
                    <div className={styles.rowView}>
                      <button type="button" className={styles.rowButton} aria-label={`Edit ${row.label}`} onClick={() => startEdit(row)}>
                        <span className={styles.rowLabel}>{row.label}</span>
                        <span className={value ? styles.rowValue : styles.muted}>{value ?? `Add ${row.label.toLowerCase()}`}</span>
                      </button>
                      {row.vis && (
                        <button
                          type="button"
                          className={styles.visToggle}
                          aria-pressed={pub}
                          aria-label={`${row.label}: ${pub ? 'visible to participants' : 'organizers only'}`}
                          disabled={saving}
                          onClick={() => row.vis && toggle(row.vis, row.label)}
                        >
                          <span aria-hidden="true">{pub ? '👁' : '🔒'}</span> {pub ? 'Visible' : 'Organizers only'}
                        </button>
                      )}
                    </div>
                  )}
                  {!pub && editing !== row.id && row.vis && HEALTH_FIELDS.includes(row.vis) && value && <p className={styles.rowNote}>Only organizers see this.</p>}
                </li>
              );
            })}
          </ul>
        </article>
        {message && (
          <p role="status" className={`${styles.alert} ${message.ok ? styles.alertOk : styles.alertBad}`}>
            {message.text}
          </p>
        )}
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
