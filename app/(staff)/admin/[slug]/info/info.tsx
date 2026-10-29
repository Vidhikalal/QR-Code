'use client';

import { useCallback, useState } from 'react';
import styles from '../admin.module.css';
import { adminUrl, errorText, useApi, useLoad } from '../api';

interface EventInfo {
  schedule: string;
  emergencyInfo: string;
}

// SPEC §11 Info (v0.6): plain text hackers see in their menu (F14). Line breaks are kept; nothing is HTML.
export function Info({ slug }: { slug: string }) {
  const api = useApi();
  const [info, setInfo] = useState<EventInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState(false);
  const load = useCallback(async () => {
    const r = await api<EventInfo>(adminUrl(slug, '/event'));
    if (r.ok) setInfo({ schedule: r.data.schedule, emergencyInfo: r.data.emergencyInfo });
    else setError(errorText(r));
  }, [api, slug]);

  useLoad(load);

  async function save(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!info) return;
    setBusy(true);
    setMessage(null);
    const r = await api<EventInfo>(adminUrl(slug, '/event'), { method: 'PATCH', body: info });
    setBusy(false);
    if (r.ok) {
      setError(null);
      setMessage('✓ Saved. Hackers see it in their menu.');
      setEditing(false);
    } else setError(r.status === 400 ? 'Too long: the schedule fits 5,000 characters, emergency info 2,000.' : errorText(r));
  }

  return (
    <>
      <div className={styles.infoPage}>
        <header className={styles.infoHeader}>
          <div>
            <p className={styles.infoEyebrow}>EVENT MANAGEMENT</p>
            <h1>Info for hackers</h1>
            <p className={styles.infoDescription}>
              Manage the event schedule and emergency information visible to
              accepted hackers.
            </p>
          </div>
        </header>

        {error && (
          <p className={`${styles.alert} ${styles.alertBad}`} role="alert">
            ✕ {error}
          </p>
        )}

        {message && (
          <p className={`${styles.alert} ${styles.alertOk}`} role="status">
            {message}
          </p>
        )}

        {!info ? (
          <p className={styles.muted}>Loading event information…</p>
        ) : !editing ? (
          <div className={styles.infoForm}>
            <section className={styles.infoSection}>
              <div className={styles.infoSectionHeading}>
                <div>
                  <h2>Event schedule</h2>
                  <p className={styles.infoDescription}>
                    Timings for check-in, sessions, meals, and activities.
                  </p>
                </div>
              </div>

              <div className={styles.infoPreview}>
                {info.schedule ? (
                  <p className={styles.infoPreviewText}>{info.schedule}</p>
                ) : (
                  <p className={styles.muted}>No schedule added yet.</p>
                )}
              </div>
            </section>

            <section className={styles.infoSection}>
              <div className={styles.infoSectionHeading}>
                <div>
                  <h2>Emergency information</h2>
                  <p className={styles.infoDescription}>
                    Important contacts and emergency instructions.
                  </p>
                </div>
              </div>

              <div className={styles.infoPreview}>
                {info.emergencyInfo ? (
                  <p className={styles.infoPreviewText}>
                    {info.emergencyInfo}
                  </p>
                ) : (
                  <p className={styles.muted}>
                    No emergency information added yet.
                  </p>
                )}
              </div>
            </section>

            <div className={styles.infoFooter}>
              <p className={styles.infoFooterNote}>
                Changes will appear on the hackers’ Schedule and Emergency
                contact pages after saving.
              </p>
              <button
                type="button"
                className={styles.infoSaveButton}
                onClick={() => {
                  setMessage(null);
                  setEditing(true);
                }}
              >
                Edit information
              </button>
            </div>
          </div>
        ) : (
          <form
            className={styles.infoForm}
            onSubmit={(e) => void save(e)}
          >
            <section className={styles.infoSection}>
              <div className={styles.infoSectionHeading}>
                <div>
                  <h2>Event schedule</h2>
                  <p className={styles.infoDescription}>
                    Add timings for check-in, sessions, meals, and activities.
                  </p>
                </div>
              </div>

              <label className={styles.field}>
                Schedule details
                <textarea
                  className={`${styles.input} ${styles.infoTextarea}`}
                  maxLength={5000}
                  value={info.schedule}
                  onChange={(e) =>
                    setInfo({ ...info, schedule: e.target.value })
                  }
                  placeholder={
                    'Sat 9:00  Check-in\nSat 10:00  Opening\nSat 12:00  Lunch'
                  }
                />
                <span className={styles.infoHint}>
                  Use separate lines to keep each activity easy to read.
                </span>
                <span className={styles.infoCounter}>
                  {info.schedule.length.toLocaleString()} / 5,000 characters
                </span>
              </label>
            </section>

            <section className={styles.infoSection}>
              <div className={styles.infoSectionHeading}>
                <div>
                  <h2>Emergency information</h2>
                  <p className={styles.infoDescription}>
                    Provide important contacts and emergency instructions.
                  </p>
                </div>
              </div>

              <label className={styles.field}>
                Emergency contacts and instructions
                <textarea
                  className={`${styles.input} ${styles.infoTextarea} ${styles.infoEmergencyTextarea}`}
                  maxLength={2000}
                  value={info.emergencyInfo}
                  onChange={(e) =>
                    setInfo({ ...info, emergencyInfo: e.target.value })
                  }
                  placeholder={
                    'Organizer on call: …\nVenue security: …\nIn a life-threatening emergency, call 911.'
                  }
                />
                <span className={styles.infoHint}>
                  Include contact details and clear instructions where applicable.
                </span>
                <span className={styles.infoCounter}>
                  {info.emergencyInfo.length.toLocaleString()} / 2,000 characters
                </span>
              </label>
            </section>

            <div className={styles.infoFooter}>
              <p className={styles.infoFooterNote}>
                Save your changes to update the information shown to hackers.
              </p>
              <div className={styles.infoActions}>
                <button
                  type="button"
                  className={styles.secondary}
                  disabled={busy}
                  onClick={() => {
                    setEditing(false);
                    setMessage(null);
                    void load();
                  }}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className={styles.infoSaveButton}
                  disabled={busy}
                >
                  {busy ? 'Saving…' : 'Save changes'}
                </button>
              </div>
            </div>
          </form>
        )}
      </div>
    </>
  );
}
