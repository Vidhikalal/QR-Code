'use client';

import Image from 'next/image';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { LOOKING_FOR_LABEL, PublicProfileCard } from '@/components/public-profile-card';
import { PHOTO_ERRORS, shrinkPhoto } from '@/lib/photo/shrink';
import { DIETARY_OPTIONS, MAX_SKILLS, SKILL_OPTIONS, YEAR_OPTIONS, formatDietary, parseDietary, type DietaryOption } from '@/lib/profile/choices';
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

type TextKey = 'nickname' | 'pronouns' | 'program' | 'bio' | 'discordHandle' | 'accessibilityNotes' | 'linkedinUrl' | 'githubUrl' | 'websiteUrl';

// The whole form; dietary is kept as its options + Other and turned into one text on save.
interface Form {
  text: Record<TextKey, string>;
  yearLabel: string;
  skills: string[];
  lookingFor: string[];
  dietary: { none: boolean; chosen: DietaryOption[]; otherOn: boolean; other: string };
  publicFields: PublicField[];
  visibility: 'public' | 'hidden';
}

const LINKS = [
  ['linkedinUrl', 'LinkedIn', 'https://www.linkedin.com/in/your-name'],
  ['githubUrl', 'GitHub', 'https://github.com/your-name'],
  ['websiteUrl', 'Website', 'https://…'],
] as const;
const TEXT_KEYS: TextKey[] = ['nickname', 'pronouns', 'program', 'bio', 'discordHandle', 'accessibilityNotes', 'linkedinUrl', 'githubUrl', 'websiteUrl'];
const HEALTH_FIELDS: readonly PublicField[] = ['dietary', 'accessibility'];

function formOf(p: Editable): Form {
  const d = parseDietary(p.dietaryNotes);
  return {
    text: Object.fromEntries(TEXT_KEYS.map((k) => [k, p[k] ?? ''])) as Record<TextKey, string>,
    yearLabel: p.yearLabel ?? '',
    skills: [...p.skills],
    lookingFor: [...p.lookingFor],
    dietary: { none: false, chosen: d.chosen, otherOn: d.other !== '', other: d.other },
    publicFields: [...p.publicFields],
    visibility: p.visibility,
  };
}

/** The PATCH body for every field (schema input shape). */
function bodyOf(f: Form, canEditDiscord: boolean): Record<string, unknown> {
  const { discordHandle, ...text } = f.text;
  return {
    ...text,
    ...(canEditDiscord && { discordHandle }),
    yearLabel: f.yearLabel,
    skills: f.skills,
    lookingFor: f.lookingFor,
    dietaryNotes: f.dietary.none ? '' : (formatDietary(f.dietary.chosen, f.dietary.otherOn ? f.dietary.other : '') ?? ''),
    publicFields: f.publicFields,
    visibility: f.visibility,
  };
}

// The profile page (demo feedback 2026-10-14): one form, one Save at the end. Each line's switch decides
// whether other participants see it; organizers always see everything. Only changed fields are sent, so
// Sheet answers the owner never touched keep following the Sheet (participants.owner_edited).
export function ProfileEditor({ initial }: { initial: ProfileViewData }) {
  const [view, setView] = useState(initial);
  const [form, setForm] = useState(() => formOf(initial.profile));
  const [customSkill, setCustomSkill] = useState('');
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const schema = useMemo(() => profilePatchSchema({ badgeRole: view.badgeRole, extraRoles: view.canEditDiscord }), [view.badgeRole, view.canEditDiscord]);

  const body = bodyOf(form, view.canEditDiscord);
  const saved = bodyOf(formOf(view.profile), view.canEditDiscord);
  const changed = Object.keys(body).filter((k) => JSON.stringify(body[k]) !== JSON.stringify(saved[k]));
  const dirty = changed.length > 0;
  const parsed = schema.safeParse(body);
  const errors = new Map<string, string>(parsed.success ? [] : parsed.error.issues.map((i) => [String(i.path[0]), i.message]));

  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const setText = (k: TextKey, v: string) => setForm((f) => ({ ...f, text: { ...f.text, [k]: v } }));
  const setDietary = (d: Partial<Form['dietary']>) => setForm((f) => ({ ...f, dietary: { ...f.dietary, ...d } }));
  const isPublic = (field: PublicField) => form.publicFields.includes(field);
  const toggleVisible = (field: PublicField) =>
    setForm((f) => ({ ...f, publicFields: f.publicFields.includes(field) ? f.publicFields.filter((x) => x !== field) : [...f.publicFields, field] }));

  function toggleSkill(s: string) {
    setForm((f) => (f.skills.includes(s) ? { ...f, skills: f.skills.filter((x) => x !== s) } : f.skills.length < MAX_SKILLS ? { ...f, skills: [...f.skills, s] } : f));
  }
  function addCustomSkill() {
    const t = customSkill.trim();
    if (!t || form.skills.length >= MAX_SKILLS) return;
    // A typed name of a listed skill picks that one, in its own spelling.
    const listed = SKILL_OPTIONS.find((o) => o.toLowerCase() === t.toLowerCase());
    const skill = listed ?? t;
    if (!form.skills.some((x) => x.toLowerCase() === skill.toLowerCase())) setForm((f) => ({ ...f, skills: [...f.skills, skill] }));
    setCustomSkill('');
  }

  async function save() {
    if (!parsed.success || !dirty) return;
    setSaving(true);
    setMessage(null);
    const patch = Object.fromEntries(changed.map((k) => [k, body[k]]));
    const res = await fetch('/api/me/profile', { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(patch) }).catch(() => null);
    setSaving(false);
    if (res?.ok) {
      const next = (await res.json()) as ProfileViewData;
      setView(next);
      setForm(formOf(next.profile));
      setMessage({ ok: true, text: '✓ Profile saved.' });
      return;
    }
    setMessage({ ok: false, text: res?.status === 401 ? '✕ You’ve been signed out. Open your newest profile link.' : '✕ Couldn’t save. Check the highlighted fields and try again.' });
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

  const visSwitch = (field: PublicField, label: string) => {
    const pub = isPublic(field);
    return (
      <button type="button" className={styles.visToggle} aria-pressed={pub} aria-label={`${label}: ${pub ? 'visible to participants' : 'organizers only'}`} onClick={() => toggleVisible(field)}>
        <span aria-hidden="true">{pub ? '👁' : '🔒'}</span> {pub ? 'Visible' : 'Organizers only'}
      </button>
    );
  };
  const errorLine = (key: string) => {
    const err = errors.get(key);
    return err ? <span className={styles.fieldError}>✕ {err}</span> : null;
  };

  // One line of the form: label, visibility switch, the input(s) and any error.
  const row = (id: string, label: string, vis: PublicField | null, children: ReactNode, hint?: ReactNode) => (
    <li key={id} className={`${styles.row} ${vis && !isPublic(vis) ? styles.rowPrivate : ''}`} data-testid={`row-${id}`}>
      <div className={styles.rowHead}>
        <span className={styles.rowLabel} id={`l-${id}`}>
          {label}
        </span>
        {vis && visSwitch(vis, label)}
      </div>
      {children}
      {hint}
      {vis && HEALTH_FIELDS.includes(vis) && !isPublic(vis) && <p className={styles.rowNote}>Only organizers see this.</p>}
    </li>
  );

  const textInput = (key: TextKey, max: number, placeholder: string, multiline = false) => {
    const value = form.text[key];
    const err = errors.get(key);
    const props = { id: `f-${key}`, value, placeholder, 'aria-labelledby': `l-${key}`, 'aria-invalid': err ? true : undefined } as const;
    return (
      <>
        {multiline ? (
          <textarea {...props} className={styles.textarea} rows={3} onChange={(e) => setText(key, e.target.value)} />
        ) : (
          <input {...props} className={styles.input} onChange={(e) => setText(key, e.target.value)} />
        )}
        <span className={err ? styles.fieldError : styles.muted}>{err ? `✕ ${err}` : `${[...value.trim()].length}/${max}`}</span>
      </>
    );
  };

  const customSkills = form.skills.filter((s) => !(SKILL_OPTIONS as readonly string[]).includes(s));
  const full = form.skills.length >= MAX_SKILLS;
  const hidden = form.visibility === 'hidden' || view.hiddenByStaff;

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
        <p className={styles.muted}>👁 Visible to other participants · 🔒 Organizers only. Organizers can always see everything.</p>
        <label className={styles.radio}>
          <input type="checkbox" checked={form.visibility === 'hidden'} onChange={(e) => setForm((f) => ({ ...f, visibility: e.target.checked ? 'hidden' : 'public' }))} />
          Hide my whole profile (others only see my name)
        </label>
        {hidden && <p className={styles.muted}>Hidden: others only see your name.</p>}
        <ul className={styles.rows}>
          {row('nickname', 'Nickname', null, textInput('nickname', 40, 'What people call you. Shown instead of your name.'))}
          {row('pronouns', 'Pronouns', 'pronouns', textInput('pronouns', 30, 'e.g. she/her'))}
          {row('program', 'Program', 'program', textInput('program', 80, 'e.g. Computer Science'))}
          {row(
            'yearLabel',
            'Year',
            'year',
            <select id="f-yearLabel" className={styles.input} aria-labelledby="l-yearLabel" value={form.yearLabel} onChange={(e) => setForm((f) => ({ ...f, yearLabel: e.target.value }))}>
              <option value="">Choose…</option>
              {YEAR_OPTIONS.map((y) => (
                <option key={y} value={y}>
                  {y}
                </option>
              ))}
            </select>,
            errorLine('yearLabel'),
          )}
          {row('bio', 'Bio', 'bio', textInput('bio', 280, 'A sentence or two about you.', true))}
          {row(
            'skills',
            'What I’m good at (required)',
            'skills',
            <fieldset className={styles.fieldset} aria-describedby="skills-count">
              <legend>Pick your top {MAX_SKILLS}</legend>
              <div className={styles.choices}>
                {SKILL_OPTIONS.map((s) => (
                  <label className={styles.radio} key={s}>
                    <input type="checkbox" checked={form.skills.includes(s)} disabled={full && !form.skills.includes(s)} onChange={() => toggleSkill(s)} /> {s}
                  </label>
                ))}
              </div>
              {customSkills.length > 0 && (
                <ul className={styles.chips} aria-label="Your own skills">
                  {customSkills.map((t) => (
                    <li key={t}>
                      {t}{' '}
                      <button type="button" className={styles.chipRemove} aria-label={`Remove ${t}`} onClick={() => toggleSkill(t)}>
                        ×
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              <div className={styles.actions}>
                <input
                  className={styles.input}
                  aria-label="Other skill"
                  placeholder="Other: type your own"
                  maxLength={30}
                  value={customSkill}
                  disabled={full}
                  onChange={(e) => setCustomSkill(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCustomSkill();
                    }
                  }}
                />
                <button type="button" className={styles.secondary} disabled={full || !customSkill.trim()} onClick={addCustomSkill}>
                  Add
                </button>
              </div>
              <span id="skills-count" className={errors.has('skills') ? styles.fieldError : styles.muted}>
                {errors.has('skills') ? `✕ ${errors.get('skills')}` : `${form.skills.length} of ${MAX_SKILLS} picked`}
              </span>
            </fieldset>,
          )}
          {row(
            'lookingFor',
            'Looking for',
            'lookingFor',
            <fieldset className={styles.fieldset}>
              <legend>Looking for</legend>
              {LOOKING_FOR.map((x) => (
                <label className={styles.radio} key={x}>
                  <input
                    type="checkbox"
                    checked={form.lookingFor.includes(x)}
                    onChange={(e) => setForm((f) => ({ ...f, lookingFor: e.target.checked ? [...f.lookingFor, x] : f.lookingFor.filter((y) => y !== x) }))}
                  />{' '}
                  {LOOKING_FOR_LABEL[x]}
                </label>
              ))}
            </fieldset>,
          )}
          {row(
            'links',
            'Links',
            'links',
            LINKS.map(([key, label, hint]) => (
              <label className={styles.field} htmlFor={`f-${key}`} key={key}>
                {label}
                <input
                  id={`f-${key}`}
                  type="url"
                  className={styles.input}
                  value={form.text[key]}
                  placeholder={hint}
                  aria-invalid={errors.has(key) ? true : undefined}
                  onChange={(e) => setText(key, e.target.value)}
                />
                {errorLine(key)}
              </label>
            )),
          )}
          {view.canEditDiscord && row('discordHandle', 'Discord', 'discord', textInput('discordHandle', 32, 'your.handle'))}
          {row(
            'dietaryNotes',
            'Dietary restrictions',
            'dietary',
            <fieldset className={styles.fieldset}>
              <legend>Dietary restrictions</legend>
              <div className={styles.choices}>
                <label className={styles.radio}>
                  <input type="checkbox" checked={form.dietary.none} onChange={(e) => setDietary(e.target.checked ? { none: true, chosen: [], otherOn: false, other: '' } : { none: false })} /> None
                </label>
                {DIETARY_OPTIONS.map((o) => (
                  <label className={styles.radio} key={o}>
                    <input
                      type="checkbox"
                      checked={form.dietary.chosen.includes(o)}
                      onChange={(e) => setDietary({ none: false, chosen: e.target.checked ? [...form.dietary.chosen, o] : form.dietary.chosen.filter((x) => x !== o) })}
                    />{' '}
                    {o}
                  </label>
                ))}
                <label className={styles.radio}>
                  <input type="checkbox" checked={form.dietary.otherOn} onChange={(e) => setDietary({ none: false, otherOn: e.target.checked })} /> Other
                </label>
              </div>
              {form.dietary.otherOn && <input className={styles.input} aria-label="Other dietary restriction" placeholder="Tell us what to avoid" value={form.dietary.other} onChange={(e) => setDietary({ other: e.target.value })} />}
              {errorLine('dietaryNotes')}
            </fieldset>,
          )}
          {row('accessibilityNotes', 'Accessibility / health needs', 'accessibility', textInput('accessibilityNotes', 500, 'Anything organizers should know', true))}
        </ul>
        <div className={styles.saveBar}>
          <button type="submit" disabled={saving || !dirty || !parsed.success}>
            {saving ? 'Saving…' : 'Save profile'}
          </button>
          <span className={styles.muted} aria-live="polite">
            {dirty ? (parsed.success ? 'Unsaved changes' : 'Fix the highlighted fields to save') : 'All changes saved'}
          </span>
        </div>
        {message && (
          <p role="alert" className={`${styles.alert} ${message.ok ? styles.alertOk : styles.alertBad}`}>
            {message.text}
          </p>
        )}
      </form>

      <section className={styles.card} aria-labelledby="preview-heading">
        <h2 id="preview-heading">How others see you</h2>
        <p className={styles.muted}>Your saved profile, as other participants see it when they tap your badge.</p>
        <PublicProfileCard profile={view.public} />
      </section>

      <section className={styles.card} aria-labelledby="photo-heading">
        <h2 id="photo-heading">Check-in photo</h2>
        <p className={styles.muted}>Only organizers and volunteers see this, at check-in. It’s never on your public profile. It saves as soon as you pick it.</p>
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
