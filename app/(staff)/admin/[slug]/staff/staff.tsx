'use client';

import { useCallback, useState } from 'react';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { ConfirmDialog } from '../dialog';

interface StaffData {
  staff: Array<{ userId: string; role: 'organizer' | 'volunteer'; displayName: string | null; isMe: boolean }>;
  invites: Array<{ email: string; role: 'organizer' | 'volunteer' }>;
}
type Pending = { kind: 'remove'; userId: string; name: string } | { kind: 'cancel'; email: string } | null;

// F9: invite by email + role. New addresses get an email to set a password; the invite is consumed on sign-in.
export function Staff({ slug }: { slug: string }) {
  const api = useApi();
  const [data, setData] = useState<StaffData | null>(null);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'volunteer' | 'organizer'>('volunteer');
  const [message, setMessage] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending>(null);

  const load = useCallback(async () => {
    const r = await api<StaffData>(adminUrl(slug, '/staff'));
    if (r.ok) setData(r.data);
    else setMessage(`✕ ${errorText(r)}`);
  }, [api, slug]);

  useLoad(load);

  async function invite() {
    const r = await api<{ code: string; emailed?: boolean }>(adminUrl(slug, '/staff/invites'), { method: 'POST', body: { email, role } });
    if (r.ok) {
      setMessage(
        r.data.code === 'ADDED'
          ? `✓ They already have an account and are now staff.`
          : r.data.emailed
            ? `✓ Invited. We emailed them a link to set their password.`
            : `✓ Invited. They can set a password with "Forgot or never set your password?" on the sign-in page.`,
      );
      setEmail('');
    } else setMessage(r.status === 400 ? '✕ Enter a valid email.' : `✕ ${errorText(r)}`);
    await load();
  }

  async function confirm(p: NonNullable<Pending>) {
    setPending(null);
    const r =
      p.kind === 'remove'
        ? await api<{ code: string }>(adminUrl(slug, `/staff/${p.userId}`), { method: 'DELETE' })
        : await api<{ code: string }>(adminUrl(slug, `/staff/invites/${encodeURIComponent(p.email)}`), { method: 'DELETE' });
    if (r.ok) setMessage(p.kind === 'remove' ? `✓ Removed ${p.name}. Their next scan will be refused.` : '✓ Invite cancelled.');
    else setMessage(r.data.code === 'LAST_ORGANIZER' ? '✕ You can’t remove the last organizer.' : `✕ ${errorText(r)}`);
    await load();
  }

  return (
    <>
      <div className={styles.staffPage}>
        <header className={styles.staffHeader}>
          <div>
            <p className={styles.staffEyebrow}>EVENT MANAGEMENT</p>
            <h1>Staff</h1>
            <p className={styles.staffDescription}>
              Manage your team, assign roles, and invite people to help run your event.
            </p>
          </div>
          <div className={styles.staffCount}>
            <span>{data?.staff.length ?? '—'}</span>
            <span>Team members</span>
          </div>
        </header>

        <section className={styles.staffSection}>
          <div className={styles.staffSectionHeading}>
            <div>
              <h2>Invite a team member</h2>
              <p className={styles.staffDescription}>
                Send an invitation by email and choose their access level.
              </p>
            </div>
          </div>

          <form
            className={styles.staffInviteForm}
            onSubmit={(e) => {
              e.preventDefault();
              void invite();
            }}
          >
            <label className={styles.field}>
              Email address
              <input
                className={styles.input}
                type="email"
                placeholder="name@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </label>

            <label className={styles.field}>
              Role
              <select
                className={styles.input}
                value={role}
                onChange={(e) =>
                  setRole(e.target.value as 'volunteer' | 'organizer')
                }
              >
                <option value="volunteer">Volunteer</option>
                <option value="organizer">Organizer</option>
              </select>
            </label>

            <button type="submit" className={styles.staffInviteButton}>
              + Send invite
            </button>
          </form>

          {message && (
            <p
              className={
                styles.alert +
                ' ' +
                (message.startsWith('✓') ? styles.alertOk : styles.alertWarn)
              }
              role="status"
            >
              {message}
            </p>
          )}
        </section>

        <section className={styles.staffSection}>
          <div className={styles.staffSectionHeading}>
            <div>
              <h2>Your team</h2>
              <p className={styles.staffDescription}>
                People who currently have access to this event.
              </p>
            </div>
            <span className={styles.staffSectionCount}>
              {data?.staff.length ?? 0} members
            </span>
          </div>

          {!data ? (
            <p className={styles.muted}>Loading team…</p>
          ) : data.staff.length === 0 ? (
            <p className={styles.staffEmpty}>No team members yet.</p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.staffTable}`}>
                <thead>
                  <tr>
                    <th>Team member</th>
                    <th>Role</th>
                    <th className={styles.staffActionsHeading}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.staff.map((s) => {
                    const name = s.displayName ?? '(no name yet)';

                    return (
                      <tr key={s.userId}>
                        <td>
                          <div className={styles.staffPerson}>
                            <span className={styles.staffAvatar} aria-hidden="true">
                              {(s.displayName?.trim() || '?').charAt(0).toUpperCase()}
                            </span>
                            <span>
                              <strong>{name}</strong>
                              {s.isMe && (
                                <span className={styles.staffYou}>You</span>
                              )}
                            </span>
                          </div>
                        </td>
                        <td>
                          <span
                            className={`${styles.staffRole} ${s.role === 'organizer'
                                ? styles.staffOrganizer
                                : styles.staffVolunteer
                              }`}
                          >
                            {s.role === 'organizer' ? 'Organizer' : 'Volunteer'}
                          </span>
                        </td>
                        <td className={styles.staffActionsCell}>
                          {!s.isMe && (
                            <button
                              type="button"
                              className={`${styles.danger} ${styles.small}`}
                              aria-label={`Remove ${name}`}
                              onClick={() =>
                                setPending({
                                  kind: 'remove',
                                  userId: s.userId,
                                  name,
                                })
                              }
                            >
                              Remove
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className={styles.staffSection}>
          <div className={styles.staffSectionHeading}>
            <div>
              <h2>Pending invitations</h2>
              <p className={styles.staffDescription}>
                Invitations waiting to be accepted.
              </p>
            </div>
            <span className={styles.staffSectionCount}>
              {data?.invites.length ?? 0} pending
            </span>
          </div>

          {!data ? (
            <p className={styles.muted}>Loading invitations…</p>
          ) : data.invites.length === 0 ? (
            <p className={styles.staffEmpty}>
              No pending invitations. Invite someone to get started.
            </p>
          ) : (
            <div className={styles.tableWrap}>
              <table className={`${styles.table} ${styles.staffTable}`}>
                <thead>
                  <tr>
                    <th>Email address</th>
                    <th>Role</th>
                    <th className={styles.staffActionsHeading}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {data.invites.map((i) => (
                    <tr key={i.email}>
                      <td className={styles.staffInviteEmail}>{i.email}</td>
                      <td>
                        <span
                          className={`${styles.staffRole} ${i.role === 'organizer'
                              ? styles.staffOrganizer
                              : styles.staffVolunteer
                            }`}
                        >
                          {i.role === 'organizer' ? 'Organizer' : 'Volunteer'}
                        </span>
                      </td>
                      <td className={styles.staffActionsCell}>
                        <button
                          type="button"
                          className={`${styles.secondary} ${styles.small}`}
                          aria-label={`Cancel invite for ${i.email}`}
                          onClick={() =>
                            setPending({ kind: 'cancel', email: i.email })
                          }
                        >
                          Cancel invite
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        {pending && (
          <ConfirmDialog
            title={
              pending.kind === 'remove'
                ? `Remove ${pending.name}?`
                : `Cancel the invite for ${pending.email}?`
            }
            body={
              <p>
                {pending.kind === 'remove'
                  ? 'They lose access immediately. Their past scans stay.'
                  : 'They won’t get access when they sign in.'}
              </p>
            }
            confirmLabel={pending.kind === 'remove' ? 'Remove' : 'Cancel invite'}
            danger
            onConfirm={() => void confirm(pending)}
            onCancel={() => setPending(null)}
          />
        )}
      </div>
    </>
  );
}
