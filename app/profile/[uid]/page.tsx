import type { Metadata } from 'next';
import { notFound, redirect } from 'next/navigation';
import { connection } from 'next/server';
import { z } from 'zod';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { normalizeUid } from '@/lib/domain/badge';
import { normalizeEmail } from '@/lib/domain/normalize';
import { CopyButton } from './copy-button';
import styles from './profile.module.css';

// SPEC §6.5: what a phone opens when it taps a badge. Public since v0.9: no sign-in needed, and
// badge_profile() returns only what the holder shares. The holder's own tap opens their menu.
// Staff link unlinked badges at check-in (v0.10). v0.9.2: Discord and website too.
// `?tap` (on tags written by the earlier datathon-badges app) is ignored.
export const metadata: Metadata = {
  title: 'Badge · Passline',
  referrer: 'no-referrer',
  robots: { index: false, follow: false },
};

const profileSchema = z
  .union([
    z.object({ allowed: z.literal(true), public: z.literal(false) }),
    z.object({
      allowed: z.literal(true),
      public: z.literal(true),
      firstName: z.string(),
      lastName: z.string(),
      linkedinUrl: z.string().nullable(),
      discord: z.string().nullable(),
      websiteUrl: z.string().nullable(),
    }),
  ])
  .nullable();

// "https://ada.dev/" → "ada.dev", "https://github.com/ada" → "github.com/ada".
const siteLabel = (href: string) => {
  const url = new URL(href);
  return `${url.host}${url.pathname}${url.search}`.replace(/\/$/, '');
};

export default async function BadgeProfilePage(props: { params: Promise<{ uid: string }> }) {
  await connection(); // per request: an opt-out must take effect on the next view
  const raw = (await props.params).uid;
  const uid = normalizeUid(raw);
  if (!uid) notFound();
  const viewer = await currentUser();

  const { data, error } = await db().rpc('badge_profile', {
    p_uid: uid,
    ...(viewer && { p_viewer_id: viewer.id, p_viewer_email: normalizeEmail(viewer.email ?? '') }),
  });
  if (error) throw new Error(`badge_profile failed (${error.code})`);
  // v0.6 (F14): the holder tapping their own badge opens their hacker menu.
  if (z.object({ self: z.literal(true) }).safeParse(data).success) redirect('/me');
  const profile = profileSchema.parse(data);

  return (
    <main className={styles.page}>
      <div className={styles.top}>
        <span className={styles.context}>Event badge</span>
      </div>
      <section className={styles.card}>
        {profile === null && (
          <>
            <h1>This badge isn’t linked yet</h1>
            <p>Staff link badges at the check-in desk.</p>
          </>
        )}
        {profile && !profile.public && (
          <>
            <h1>This attendee hasn’t shared a profile</h1>
            <p>They can choose to share their name and links from their Passline account.</p>
          </>
        )}
        {profile?.public && (
          <>
            <h1 className={styles.name}>{`${profile.firstName} ${profile.lastName}`.trim()}</h1>
            {profile.linkedinUrl && (
              <a className={styles.link} href={profile.linkedinUrl} rel="noopener noreferrer">
                View LinkedIn profile
              </a>
            )}
            {profile.discord && (
              <div className={styles.row}>
                <span className={styles.label}>Discord</span>
                <span className={styles.value}>@{profile.discord}</span>
                <CopyButton text={profile.discord} label="Copy Discord username" />
              </div>
            )}
            {profile.websiteUrl && (
              <div className={styles.row}>
                <span className={styles.label}>Website</span>
                {/* The holder typed this link: nofollow/ugc, and its address is the label so the tapper sees where it goes. */}
                <a className={styles.value} href={profile.websiteUrl} rel="nofollow noopener noreferrer ugc">
                  {siteLabel(profile.websiteUrl)}
                </a>
              </div>
            )}
            {!profile.linkedinUrl && !profile.discord && !profile.websiteUrl && <p>No links shared.</p>}
          </>
        )}
      </section>
    </main>
  );
}
