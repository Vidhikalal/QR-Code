import { useCallback, useEffect, useRef } from 'react';
import { badgeUrl, badgeWritable, normalizeUid, type BadgeWriteOutcome } from '@/lib/domain/badge';
import type { NfcTag } from './nfc';

// Chrome queues writes until a tag is in range: never let one spill onto the next badge.
export function useBadgeWrite(origin: string) {
  const pending = useRef<{ uid: string; abort: AbortController } | null>(null);
  const cancel = useCallback(() => pending.current?.abort.abort(), []);
  useEffect(() => cancel, [cancel]);

  const observe = useCallback((serial: string) => {
    if (pending.current && normalizeUid(serial) !== pending.current.uid) cancel();
  }, [cancel]);

  const write = useCallback(async (tag: NfcTag, reader: NDEFReader, uid: string): Promise<BadgeWriteOutcome> => {
    if (!badgeWritable(origin)) return 'unchanged';
    const url = badgeUrl(origin, uid);
    const record = tag.records[0];
    if (tag.records.length === 1 && record?.recordType === 'url' && record.data && new TextDecoder().decode(record.data) === url) return 'unchanged';
    const abort = new AbortController();
    const attempt = { uid, abort };
    pending.current = attempt;
    const timer = setTimeout(() => abort.abort(), 5000);
    try {
      await Promise.race([
        reader.write({ records: [{ recordType: 'url', data: url }] }, { signal: abort.signal }),
        new Promise<never>((_, reject) => abort.signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })),
      ]);
      return abort.signal.aborted ? 'failed' : 'written';
    } catch {
      return 'failed';
    } finally {
      clearTimeout(timer);
      if (pending.current === attempt) pending.current = null;
    }
  }, [origin]);

  return { write, cancel, observe };
}
