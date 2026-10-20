import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { currentUser } from '@/lib/auth/session';
import { db } from '@/lib/db/server';
import { formatJoinCode } from '@/lib/domain/team';
import { myEvent } from '@/lib/me/profile';
import { createTeam, joinTeam, leaveTeam, myTeam, setTeamTrack, type TeamCode } from '@/lib/me/team';
import formStyles from '../../login/login.module.css';
import styles from '../../profile/[uid]/profile.module.css';
import me from '../me.module.css';
import { loadMyEvent, menuMetadata } from '../load';

export const metadata: Metadata = menuMetadata('Team');

const NOTICES: Record<TeamCode, string> = {
  CREATED: '✓ Team created. Share the code with your teammates.',
  JOINED: '✓ You joined the team.',
  LEFT: '✓ You left the team.',
  SAVED: '✓ Track saved.',
  IN_A_TEAM: '✕ You’re already in a team. Leave it first.',
  NAME_TAKEN: '✕ Another team already has that name.',
  BAD_CODE: '✕ No team has that code. Check it and try again.',
  TEAM_FULL: '✕ That team already has 4 people.',
  CLOSED: '✕ Teams are closed right now. Ask an organizer.',
  NOT_RELEASED: '✕ Tracks aren’t released yet.',
  NOT_FOUND: '✕ Something changed. Reload the page and try again.',
  INVALID_NAME: '✕ Give your team a name, up to 60 characters.',
};

// SPEC F15 (v0.7): create, join, leave and pick a track. The participant comes from the session, never the form.
async function act(formData: FormData) {
  'use server';
  const user = await currentUser();
  if (!user) redirect('/login?next=/me/team');
  const m = await myEvent(db(), user.email ?? '', new Date());
  if (!m) redirect('/me/team?r=NOT_FOUND');
  const field = (k: string) => String(formData.get(k) ?? '');
  const op = field('op');
  const r =
    op === 'create'
      ? await createTeam(db(), user, m.participantId, field('name'))
      : op === 'join'
        ? await joinTeam(db(), user, m.participantId, { code: field('code') })
        : op === 'leave'
          ? await leaveTeam(db(), user, m.participantId)
          : await setTeamTrack(db(), user, m.participantId, field('trackId'));
  redirect(`/me/team?r=${r}`);
}

export default async function TeamPage(props: { searchParams: Promise<{ r?: string }> }) {
  const { r } = await props.searchParams;
  const { me: m, now } = await loadMyEvent('/me/team');
  const { tracks, team } = await myTeam(db(), m);
  const live = Date.parse(m.event.endsAt) > now.getTime();
  const open = m.event.teamsOpen && live;
  const notice = r && r in NOTICES ? NOTICES[r as TeamCode] : null;
  const trackName = tracks.find((t) => t.id === team?.trackId)?.name;

  return (
    <main className={styles.page}>
      <Link className={me.back} href="/me">
        ← Menu
      </Link>
      <p className={styles.eyebrow}>{m.event.name}</p>
      <h1>Team</h1>
      {notice && (
        <p role={notice.startsWith('✓') ? 'status' : 'alert'} className={notice.startsWith('✓') ? formStyles.ok : formStyles.error}>
          {notice}
        </p>
      )}
      {team ? (
        <section aria-labelledby="team-name" className={styles.card} style={{ marginTop: 16 }}>
          <h2 id="team-name">{team.name}</h2>
          <ul>
            {team.members.map((name) => (
              <li key={name}>{name}</li>
            ))}
          </ul>
          <p style={{ marginTop: 8 }}>
            Join code: <strong>{formatJoinCode(team.code)}</strong>. Share it with your teammates (4 people at most).
          </p>
          <h3 style={{ marginTop: 16 }}>Track</h3>
          {!m.event.tracksReleased ? (
            <p>Tracks are announced at the hackathon.</p>
          ) : live && tracks.length > 0 ? (
            <form action={act} className={formStyles.form}>
              <input type="hidden" name="op" value="track" />
              <label htmlFor="trackId">Your team’s track</label>
              <select id="trackId" name="trackId" defaultValue={team.trackId ?? ''} required className={formStyles.input}>
                <option value="" disabled>
                  Pick a track
                </option>
                {tracks.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
              <button type="submit">Save track</button>
            </form>
          ) : (
            <p>{trackName ?? 'No track chosen.'}</p>
          )}
          {open && (
            <form action={act} className={formStyles.form}>
              <input type="hidden" name="op" value="leave" />
              {team.members.length === 1 && <p>You’re the only member: leaving deletes the team.</p>}
              <button type="submit">Leave team</button>
            </form>
          )}
        </section>
      ) : !open ? (
        <p>{live ? 'Teams open on hackathon day. Come back then to create or join one.' : 'The event is over.'}</p>
      ) : (
        <>
          <section aria-labelledby="create" className={styles.card} style={{ marginTop: 16 }}>
            <h2 id="create">Create a team</h2>
            <form action={act} className={formStyles.form}>
              <input type="hidden" name="op" value="create" />
              <label htmlFor="name">Team name</label>
              <input id="name" name="name" required maxLength={60} autoComplete="off" className={formStyles.input} />
              <button type="submit">Create team</button>
            </form>
          </section>
          <section aria-labelledby="join" className={styles.card} style={{ marginTop: 16 }}>
            <h2 id="join">Join with a code</h2>
            <form action={act} className={formStyles.form}>
              <input type="hidden" name="op" value="join" />
              <label htmlFor="code">Join code</label>
              <input id="code" name="code" required maxLength={20} autoComplete="off" autoCapitalize="characters" placeholder="ABCD-EFGH" className={formStyles.input} />
              <button type="submit">Join team</button>
            </form>
          </section>
        </>
      )}
    </main>
  );
}
