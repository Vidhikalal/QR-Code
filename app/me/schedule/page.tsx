import type { Metadata } from 'next';
import Link from 'next/link';
import { parseSchedule } from '@/lib/domain/schedule';
import styles from '../../profile/[uid]/profile.module.css';
import me from '../me.module.css';
import { loadMyEvent, menuMetadata } from '../load';

export const metadata: Metadata = menuMetadata('Schedule');

// SPEC F14: the schedule organizers type on the admin Info page (plain text, rendered escaped). v0.8.2:
// `9:00-10:00 | Title | Place` lines show as time slots under the day lines above them.
export default async function SchedulePage() {
  const { me: m } = await loadMyEvent('/me/schedule');
  const sections = parseSchedule(m.event.schedule);
  return (
    <main className={styles.page}>
      <div className={styles.top}>
        <Link className={me.back} href="/me">
          ← Menu
        </Link>
        <span className={styles.context}>{m.event.name}</span>
      </div>
      <h1>Schedule</h1>
      {sections ? (
        sections.map((s, i) => (
          <div key={i} className={me.day}>
            {/* A line heads the slots below it; one with none below (a closing note) is just text. */}
            {s.label && (s.slots.length > 0 ? <h2 className={me.dayLabel}>{s.label}</h2> : <p className={me.text}>{s.label}</p>)}
            {s.slots.length > 0 && (
              <ol className={me.slots}>
                {s.slots.map((t, j) => (
                  <li key={j} className={me.slot}>
                    <span className={me.slotTime}>{t.end ? `${t.start} → ${t.end}` : t.start}</span>
                    <strong>{t.title}</strong>
                    {t.place && <span className={me.slotPlace}>{t.place}</span>}
                  </li>
                ))}
              </ol>
            )}
          </div>
        ))
      ) : (
        <section className={styles.card}>
          <p className={me.text}>{m.event.schedule || 'The organizers haven’t posted the schedule yet.'}</p>
        </section>
      )}
    </main>
  );
}
