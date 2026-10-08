import type { PublicProfile } from '@/lib/profile/public';
import styles from './public-profile-card.module.css';

const LINK_REL = 'noopener noreferrer nofollow ugc';

// Renders PublicProfile (I-19) and nothing else. Every value is a React text node (escaped); links are
// https-only by the DB checks, open in a new tab, and are never fetched or previewed server-side.
export function PublicProfileCard({ profile, privateNote = 'This profile is private.' }: { profile: PublicProfile; privateNote?: string }) {
  return (
    <article className={styles.card} aria-label={`Profile of ${profile.displayName}`}>
      <p className={styles.event}>{profile.eventName}</p>
      <h3 className={styles.name}>{profile.displayName}</h3>
      {profile.label && <span className={styles.label}>{profile.label}</span>}
      {profile.hidden ? (
        <p className={styles.private}>{privateNote}</p>
      ) : (
        <>
          {(profile.pronouns || profile.program || profile.yearLabel) && (
            <p className={styles.meta}>{[profile.pronouns, profile.program, profile.yearLabel].filter(Boolean).join(' · ')}</p>
          )}
          {profile.bio && <p className={styles.bio}>{profile.bio}</p>}
          {profile.askMeAbout.length > 0 && (
            <>
              <p className={styles.meta}>Ask me about</p>
              <ul className={styles.topics}>
                {profile.askMeAbout.map((t) => (
                  <li key={t}>{t}</li>
                ))}
              </ul>
            </>
          )}
          {(profile.links.linkedin || profile.links.github || profile.links.website || profile.discord) && (
            <ul className={styles.links}>
              {profile.links.linkedin && (
                <li>
                  <a href={profile.links.linkedin} target="_blank" rel={LINK_REL}>
                    LinkedIn
                  </a>
                </li>
              )}
              {profile.links.github && (
                <li>
                  <a href={profile.links.github} target="_blank" rel={LINK_REL}>
                    GitHub
                  </a>
                </li>
              )}
              {profile.links.website && (
                <li>
                  <a href={profile.links.website} target="_blank" rel={LINK_REL}>
                    Website
                  </a>
                </li>
              )}
              {profile.discord && <li className={styles.meta}>Discord: {profile.discord}</li>}
            </ul>
          )}
        </>
      )}
    </article>
  );
}
