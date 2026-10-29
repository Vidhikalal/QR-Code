'use client';

import { useState } from 'react';
import styles from '../admin.module.css';
import { adminUrl } from '../api';

// §11 / §13: CSVs are built server-side by toCsv() (I-13); these are plain download links.
export function Export({ slug }: { slug: string }) {
  const [includeVoided, setIncludeVoided] = useState(false);
  const link = (kind: string, query = '') => adminUrl(slug, `/export/${kind}${query}`);
  return (
    <>
      <div className={styles.exportPage}>
      <header className={styles.exportHeader}>
        <div>
          <p className={styles.exportEyebrow}>EVENT MANAGEMENT</p>
          <h1>Export data</h1>
          <p className={styles.exportDescription}>
            Download your event data as CSV files for reporting, analysis,
            and record keeping.
          </p>
        </div>
      </header>

      <div className={styles.exportNotice}>
        <span className={styles.exportNoticeIcon} aria-hidden="true">
          i
        </span>
        <p>
          Files use UTF-8 encoding and are compatible with Excel. Timestamps
          are provided in UTC and the event’s timezone, as applicable.
        </p>
      </div>

      <section className={styles.exportSection}>
        <div className={styles.exportSectionHeading}>
          <h2>Available exports</h2>
          <p className={styles.exportDescription}>
            Choose the data you want to download.
          </p>
        </div>

        <div className={styles.exportList}>
          <article className={styles.exportCard}>
            <div className={styles.exportCardIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M8 3.75h6l4 4v12.5H6V3.75h2Z"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinejoin="round"
                />
                <path
                  d="M14 3.75v4h4M9 12h6M9 15.5h6"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <div className={styles.exportCardContent}>
              <h3>Participants</h3>
              <p>
                Export participant records for attendance tracking and
                event administration.
              </p>
              <span className={styles.exportFileType}>CSV FILE</span>
            </div>

            <a
              className={`button ${styles.linkButton} ${styles.exportDownload}`}
              href={link('participants.csv')}
              download
            >
              Download
              <span aria-hidden="true">↓</span>
            </a>
          </article>

          <article className={styles.exportCard}>
            <div className={styles.exportCardIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M12 3.5v4m0 9v4M3.5 12h4m9 0h4M6 6l2.8 2.8m6.4 6.4L18 18M18 6l-2.8 2.8m-6.4 6.4L6 18"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
                <circle
                  cx="12"
                  cy="12"
                  r="4"
                  stroke="currentColor"
                  strokeWidth="1.6"
                />
              </svg>
            </div>

            <div className={styles.exportCardContent}>
              <h3>Scans</h3>
              <p>
                Export checkpoint scan records, including voided scans if
                selected.
              </p>
              <span className={styles.exportFileType}>CSV FILE</span>

              <label className={styles.exportCheckbox}>
                <input
                  type="checkbox"
                  checked={includeVoided}
                  onChange={(e) => setIncludeVoided(e.target.checked)}
                />
                <span>Include voided scans</span>
              </label>
            </div>

            <a
              className={`button ${styles.linkButton} ${styles.exportDownload}`}
              href={link(
                'scans.csv',
                includeVoided ? '?includeVoided=1' : '',
              )}
              download
            >
              Download
              <span aria-hidden="true">↓</span>
            </a>
          </article>

          <article className={styles.exportCard}>
            <div className={styles.exportCardIcon} aria-hidden="true">
              <svg viewBox="0 0 24 24" fill="none">
                <path
                  d="M4 19.5h16M6.5 16V10m5.5 6V4.5m5.5 11.5v-8"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
              </svg>
            </div>

            <div className={styles.exportCardContent}>
              <h3>Checkpoint summary</h3>
              <p>
                Download a summary of checkpoint activity for event
                reporting.
              </p>
              <span className={styles.exportFileType}>CSV FILE</span>
            </div>

            <a
              className={`button ${styles.linkButton} ${styles.exportDownload}`}
              href={link('summary.csv')}
              download
            >
              Download
              <span aria-hidden="true">↓</span>
            </a>
          </article>
        </div>
      </section>
    </div>
    </>
  );
}
