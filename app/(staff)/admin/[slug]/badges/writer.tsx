'use client';

import { useEffect, useRef, useState } from 'react';
import { badgeUrl, badgeWritable, formatUid, normalizeUid } from '@/lib/domain/badge';
import { useNfcReader, type NfcTag } from '@/lib/scanner/nfc';
import styles from '../admin.module.css';

const decoder = new TextDecoder();
const WRITE_TIMEOUT_MS = 5000;

// SPEC §11 / §6.5 tag writer, ported from datathon-badges. Writes the badge link onto each tag tapped;
// linking a badge to a person happens at the door (scanner "Link badge"), not here.
export function BadgeWriter({ origin }: { origin: string }) {
  const writable = badgeWritable(origin);
  const [status, setStatus] = useState<{ ok: boolean; text: string } | null>(null);
  // Chrome keeps a write pending until a tag is in range, so a tag pulled away too soon would get its
  // link written onto the NEXT tag. Every write is cancelled on Stop, on leaving, on a different tag, or on timeout.
  const pending = useRef<{ uid: string; abort: AbortController } | null>(null);
  const cancelWrite = () => pending.current?.abort.abort();
  useEffect(() => cancelWrite, []);

  async function onTag({ serial, records }: NfcTag, reader: NDEFReader) {
    if (!writable) return; // never write http:// onto a physical tag
    const uid = normalizeUid(serial);
    if (!uid) return setStatus({ ok: false, text: 'That tag doesn’t report a usable UID, so it can’t be a badge.' });
    if (pending.current) {
      if (pending.current.uid !== uid) cancelWrite();
      return;
    }
    const link = badgeUrl(origin, uid);
    if (records.some((r) => r.recordType === 'url' && r.data && decoder.decode(r.data) === link)) {
      return setStatus({ ok: true, text: `${formatUid(uid)} already has its link.` });
    }
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), WRITE_TIMEOUT_MS);
    pending.current = { uid, abort };
    try {
      await reader.write({ records: [{ recordType: 'url', data: link }] }, { signal: abort.signal });
      setStatus({ ok: true, text: `Wrote the link to ${formatUid(uid)}. Tap it again to check.` });
    } catch {
      setStatus({ ok: false, text: `Didn’t write to ${formatUid(uid)}. Hold the tag still and tap it again.` });
    } finally {
      clearTimeout(timer);
      pending.current = null;
    }
  }

  // Never starts on its own: writing to tags only ever begins with a tap on "Start writing".
  const nfc = useNfcReader({
    prefKey: 'passline:writer',
    defaultOn: false,
    autoStart: false,
    onTag: (tag, reader) => void onTag(tag, reader),
    onUnreadable: () => setStatus({ ok: false, text: 'That tag isn’t NDEF-compatible, so it can’t hold a link.' }),
  });

  return (
    <section>
      <h1>Badges</h1>
      <p>
        Writes <code>{badgeUrl(origin, '<uid>')}</code> onto each tag you tap. After that, any phone (iPhone included)
        opens the badge’s profile page. Link a badge to its owner at the door, in the scanner.
      </p>
      {!writable && (
        <p className={`${styles.alert} ${styles.alertWarn}`} role="alert">
          ! Badge links must start with https://, or phones can’t open them. Set BADGE_ORIGIN to the public address,
          e.g. https://nfc.yvesdonato.com.
        </p>
      )}
      {nfc.supported && writable && (
        <button
          type="button"
          aria-pressed={nfc.state !== 'off'}
          onClick={() => {
            if (nfc.state === 'off') return void nfc.start();
            cancelWrite();
            nfc.stop();
          }}
        >
          {nfc.state === 'off' ? 'Start writing' : nfc.state === 'starting' ? 'Starting…' : 'Writing: tap to stop'}
        </button>
      )}
      {nfc.error && (
        <p className={`${styles.alert} ${styles.alertBad}`} role="alert">
          ✕ {nfc.error}
        </p>
      )}
      {status && (
        <p className={`${styles.alert} ${status.ok ? styles.alertOk : styles.alertBad}`} role="status">
          {status.ok ? '✓' : '✕'} {status.text}
        </p>
      )}
    </section>
  );
}
