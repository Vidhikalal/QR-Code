import { normalizeUid } from '@/lib/badge/tags';

// PLAN §11.2: Web NFC (Chrome on Android, HTTPS, a user gesture to start). Browser only.
// D5: badges are password-protected by organizers with NFC Tools; this code never locks a tag.

export interface NfcTap {
  /** Chip serial, normalized (uppercase hex), or null if the browser didn't give one. */
  uid: string | null;
  /** The first URL record on the tag, or null (a blank tag). */
  url: string | null;
}
export type NfcError = 'unsupported' | 'permission-denied' | 'not-readable' | 'write-failed' | 'aborted';

export interface NfcReader {
  start(onTap: (tap: NfcTap) => void, onError: (e: NfcError) => void): Promise<void>;
  stop(): void;
  write(url: string): Promise<void>;
}

interface NdefRecordLike {
  recordType: string;
  data?: DataView | ArrayBufferView | ArrayBuffer | null;
}
interface ReadingLike {
  serialNumber?: string;
  message: { records: readonly NdefRecordLike[] };
}
interface NdefReaderLike extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(message: { records: Array<{ recordType: 'url'; data: string }> }, options?: { signal?: AbortSignal }): Promise<void>;
}
type NdefReaderClass = new () => NdefReaderLike;

const ndefReaderClass = (): NdefReaderClass | undefined => (globalThis as { NDEFReader?: NdefReaderClass }).NDEFReader;

export function isWebNfcSupported(): boolean {
  return typeof window !== 'undefined' && ndefReaderClass() !== undefined;
}

/** Pure: a `reading` event → what the app needs. */
export function decodeReading(event: ReadingLike): NfcTap {
  const record = event.message.records.find((r) => r.recordType === 'url' && r.data);
  return {
    uid: event.serialNumber ? normalizeUid(event.serialNumber) : null,
    url: record?.data ? new TextDecoder().decode(record.data) : null,
  };
}

export function nfcErrorKind(err: unknown): NfcError {
  const name = err instanceof DOMException ? err.name : '';
  if (name === 'NotAllowedError') return 'permission-denied';
  if (name === 'NotSupportedError') return 'unsupported';
  if (name === 'AbortError') return 'aborted';
  return 'write-failed';
}

export function createNfcReader(): NfcReader {
  let reader: NdefReaderLike | null = null;
  let controller: AbortController | null = null;
  const ensure = (): NdefReaderLike => {
    const Cls = ndefReaderClass();
    if (!Cls) throw new DOMException('Web NFC unavailable', 'NotSupportedError');
    reader ??= new Cls();
    return reader;
  };
  return {
    async start(onTap, onError) {
      let r: NdefReaderLike;
      try {
        r = ensure();
      } catch {
        onError('unsupported');
        return;
      }
      controller?.abort();
      controller = new AbortController();
      r.addEventListener('reading', (e) => onTap(decodeReading(e as unknown as ReadingLike)), { signal: controller.signal });
      r.addEventListener('readingerror', () => onError('not-readable'), { signal: controller.signal });
      try {
        await r.scan({ signal: controller.signal });
      } catch (err) {
        onError(nfcErrorKind(err));
      }
    },
    stop() {
      controller?.abort();
      controller = null;
    },
    async write(url) {
      try {
        await ensure().write({ records: [{ recordType: 'url', data: url }] });
      } catch (err) {
        throw new NfcWriteError(nfcErrorKind(err));
      }
    },
  };
}

export class NfcWriteError extends Error {
  override readonly name = 'NfcWriteError';
  constructor(readonly kind: NfcError) {
    super(`nfc ${kind}`);
  }
}
