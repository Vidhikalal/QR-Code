'use client';

import { useEffect, useRef, useState } from 'react';
import { createNfcReader, type NfcReader } from '@/lib/nfc/web-nfc';

interface RawRecord {
  recordType: string;
  mediaType?: string;
  data?: DataView;
}
interface RawReading extends Event {
  serialNumber?: string;
  message?: { records: readonly RawRecord[] };
}
interface RawReader extends EventTarget {
  scan(options?: { signal?: AbortSignal }): Promise<void>;
  write(message: { records: Array<{ recordType: 'url'; data: string } | { recordType: 'empty' }> }): Promise<void>;
  onreading: ((e: RawReading) => void) | null;
  onreadingerror: ((e: Event) => void) | null;
}

const time = () => new Date().toLocaleTimeString('en-US', { hour12: false });
function describeRecord(r: RawRecord): string {
  let text = '';
  try {
    text = r.data ? new TextDecoder().decode(r.data) : '(no data)';
  } catch {
    text = '(undecodable)';
  }
  return `${r.recordType}${r.mediaType ? ` (${r.mediaType})` : ''}: ${text.slice(0, 120)}`;
}

// Two readers side by side: (A) the textbook Web NFC code, (B) the app's own reader (lib/nfc/web-nfc.ts).
export function NfcTest() {
  const [log, setLog] = useState<string[]>([]);
  const add = (line: string) => setLog((l) => [`${time()}  ${line}`, ...l].slice(0, 80));
  const plainAbort = useRef<AbortController | null>(null);
  const appReader = useRef<NfcReader | null>(null);
  const [env, setEnv] = useState('checking…');
  const video = useRef<HTMLVideoElement | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const [cameraOn, setCameraOn] = useState(false);

  // D: the scanner keeps the rear camera running. Does that stop NFC taps on this phone?
  async function toggleCamera() {
    if (stream.current) {
      for (const t of stream.current.getTracks()) t.stop();
      stream.current = null;
      setCameraOn(false);
      return add('D: camera OFF');
    }
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (video.current) {
        video.current.srcObject = stream.current;
        await video.current.play().catch(() => undefined);
      }
      setCameraOn(true);
      add('D: camera ON (rear). Now tap a badge with A or B running.');
    } catch (err) {
      add(`D: camera failed: ${err instanceof DOMException ? `${err.name}: ${err.message}` : String(err)}`);
    }
  }

  useEffect(() => {
    const parts = [
      `secure context: ${window.isSecureContext}`,
      `NDEFReader: ${'NDEFReader' in window}`,
      `origin: ${window.location.origin}`,
      `user agent: ${navigator.userAgent}`,
    ];
    void navigator.permissions
      ?.query({ name: 'nfc' as PermissionName })
      .then((p) => setEnv([...parts, `nfc permission: ${p.state}`].join('\n')))
      .catch(() => setEnv([...parts, 'nfc permission: (query not supported)'].join('\n')));
    const onVis = () => add(`page ${document.visibilityState}`);
    const onFocus = () => add('page focused');
    const onBlur = () => add('page lost focus (Chrome pauses NFC)');
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onFocus);
    window.addEventListener('blur', onBlur);
    return () => {
      document.removeEventListener('visibilitychange', onVis);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('blur', onBlur);
    };
  }, []);

  async function startPlain() {
    const Cls = (window as unknown as { NDEFReader?: new () => RawReader }).NDEFReader;
    if (!Cls) return add('A: NDEFReader is not available in this browser');
    plainAbort.current?.abort();
    plainAbort.current = new AbortController();
    const reader = new Cls();
    reader.onreading = (e) => {
      const records = e.message?.records ?? [];
      add(`A: READ serial=${e.serialNumber ?? '(none)'} records=${records.length}${records.map((r) => `\n     ${describeRecord(r)}`).join('')}`);
    };
    reader.onreadingerror = () => add('A: readingerror (tag seen but not readable as NDEF)');
    add('A: calling scan()…');
    try {
      await reader.scan({ signal: plainAbort.current.signal });
      add('A: scan() resolved: Chrome says it is listening. Tap a badge.');
    } catch (err) {
      add(`A: scan() failed: ${err instanceof DOMException ? `${err.name}: ${err.message}` : String(err)}`);
    }
  }

  // C: what Register needs. On a tap, write a test URL straight away (no network) and time it.
  async function startWrite() {
    const Cls = (window as unknown as { NDEFReader?: new () => RawReader }).NDEFReader;
    if (!Cls) return add('C: NDEFReader is not available in this browser');
    plainAbort.current?.abort();
    plainAbort.current = new AbortController();
    const reader = new Cls();
    let busy = false;
    reader.onreading = async (e) => {
      if (busy) return;
      busy = true;
      const url = `${window.location.origin}/nfc-test#written-${Date.now()}`;
      const t0 = performance.now();
      add(`C: read serial=${e.serialNumber ?? '(none)'}, writing…`);
      try {
        await reader.write({ records: [{ recordType: 'url', data: url }] });
        add(`C: WRITE OK in ${Math.round(performance.now() - t0)} ms. Press A and tap again to see the URL.`);
      } catch (err) {
        add(`C: write failed after ${Math.round(performance.now() - t0)} ms: ${err instanceof DOMException ? `${err.name}: ${err.message}` : String(err)}`);
      } finally {
        busy = false;
      }
    };
    try {
      await reader.scan({ signal: plainAbort.current.signal });
      add('C: listening. Hold a badge to the phone and keep it there for 2 seconds.');
    } catch (err) {
      add(`C: scan() failed: ${err instanceof DOMException ? `${err.name}: ${err.message}` : String(err)}`);
    }
  }

  // E: wipe test badges. Writes one "empty" record (Web NFC can't write a message with no records), so
  // the chip carries no URL and the app treats it as blank. Fails on a password-protected badge.
  async function startClear() {
    const Cls = (window as unknown as { NDEFReader?: new () => RawReader }).NDEFReader;
    if (!Cls) return add('E: NDEFReader is not available in this browser');
    plainAbort.current?.abort();
    plainAbort.current = new AbortController();
    const reader = new Cls();
    let busy = false;
    reader.onreading = async (e) => {
      if (busy) return;
      busy = true;
      const before = (e.message?.records ?? []).map((r) => describeRecord(r)).join(' | ') || '(already empty)';
      try {
        await reader.write({ records: [{ recordType: 'empty' }] });
        add(`E: CLEARED serial=${e.serialNumber ?? '(none)'}. It held: ${before}`);
      } catch (err) {
        add(`E: clear failed: ${err instanceof DOMException ? `${err.name}: ${err.message}` : String(err)} (password-protected? hold it still and try again)`);
      } finally {
        busy = false;
      }
    };
    try {
      await reader.scan({ signal: plainAbort.current.signal });
      add('E: ready. Hold each badge to the phone for 2 seconds to clear it. Press another button to stop.');
    } catch (err) {
      add(`E: scan() failed: ${err instanceof DOMException ? `${err.name}: ${err.message}` : String(err)}`);
    }
  }

  async function startApp() {
    appReader.current?.stop();
    appReader.current = createNfcReader();
    add('B: starting the app reader…');
    await appReader.current.start(
      (tap) => add(`B: TAP uid=${tap.uid ?? '(none)'} url=${tap.url ?? '(none)'}`),
      (e) => add(`B: error ${e}`),
    );
    add('B: start() returned');
  }


  return (
    <main style={{ maxWidth: 640, margin: '0 auto', padding: 16, fontFamily: 'system-ui, sans-serif' }}>
      <h1 style={{ fontSize: 22 }}>NFC test</h1>
      <p>Press one button, allow NFC if Chrome asks, then hold a badge to the back of the phone for a second. Then try the other button. Send a screenshot of the log.</p>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" style={{ minHeight: 44 }} onClick={() => void startPlain()}>
          A: Start (plain Web NFC)
        </button>
        <button type="button" style={{ minHeight: 44 }} onClick={() => void startApp()}>
          B: Start (app reader)
        </button>
        <button type="button" style={{ minHeight: 44 }} onClick={() => void startWrite()}>
          C: Write test
        </button>
        <button type="button" style={{ minHeight: 44, background: '#991b1b' }} onClick={() => void startClear()}>
          E: Clear a badge
        </button>
        <button type="button" style={{ minHeight: 44 }} onClick={() => void toggleCamera()}>
          D: Camera {cameraOn ? 'off' : 'on'}
        </button>
        <button type="button" style={{ minHeight: 44 }} onClick={() => setLog([])}>
          Clear log
        </button>
      </div>
      <video ref={video} playsInline muted style={{ width: 160, display: cameraOn ? 'block' : 'none', borderRadius: 8, marginTop: 8 }} />
      <pre style={{ whiteSpace: 'pre-wrap', fontSize: 12, background: '#f4f4f5', padding: 8, borderRadius: 8 }}>{env}</pre>
      <pre data-testid="nfc-log" style={{ whiteSpace: 'pre-wrap', fontSize: 13, minHeight: 200, border: '1px solid #ddd', padding: 8, borderRadius: 8 }}>
        {log.join('\n') || '(log is empty)'}
      </pre>
    </main>
  );
}
