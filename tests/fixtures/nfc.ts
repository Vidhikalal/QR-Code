import type { Page } from '@playwright/test';

// Playwright can't emulate NFC (PLAN §11.2). This replaces only the browser API: a stub NDEFReader
// whose `reading` events the test fires with window.__nfcTap(serial, url). lib/nfc/web-nfc.ts runs
// unchanged against it. window.__nfc.writes records written URLs; __nfc.failWrite makes writes fail.
// `scan`: 'resolve' (default) starts at once; 'pending' never settles (Chrome waiting on its permission
// prompt); 'deny' rejects with NotAllowedError (permission refused).
export async function installFakeNfc(page: Page, opts: { scan?: 'resolve' | 'pending' | 'deny' } = {}): Promise<void> {
  await page.addInitScript((scanMode: string) => {
    type Rec = { recordType: string; data: Uint8Array };
    const state = { readers: [] as EventTarget[], writes: [] as string[], failWrite: false };
    class FakeNDEFReader extends EventTarget {
      scan() {
        if (scanMode === 'pending') return new Promise<void>(() => undefined);
        if (scanMode === 'deny') return Promise.reject(new DOMException('NFC permission denied', 'NotAllowedError'));
        state.readers.push(this);
        return Promise.resolve();
      }
      async write(message: { records: Array<{ recordType: string; data: string }> }) {
        if (state.failWrite) throw new DOMException('Tag moved', 'NetworkError');
        state.writes.push(message.records[0]?.data ?? '');
      }
    }
    const w = window as unknown as Record<string, unknown>;
    w.NDEFReader = FakeNDEFReader;
    w.__nfc = state;
    w.__nfcTap = (serialNumber: string, url: string | null) => {
      const records: Rec[] = url ? [{ recordType: 'url', data: new TextEncoder().encode(url) }] : [];
      for (const r of state.readers) {
        const event = new Event('reading');
        Object.defineProperty(event, 'serialNumber', { value: serialNumber });
        Object.defineProperty(event, 'message', { value: { records } });
        r.dispatchEvent(event);
      }
    };
  }, opts.scan ?? 'resolve');
}

/** "04A23B…" → "04:a2:3b:…", the way Web NFC reports serials. */
export const webNfcSerial = (uid: string) => (uid.match(/../g) ?? []).join(':').toLowerCase();

export async function tap(page: Page, uid: string, url: string | null): Promise<void> {
  await page.evaluate(([serial, u]) => (window as unknown as { __nfcTap: (s: string, u: string | null) => void }).__nfcTap(serial ?? '', u ?? null), [webNfcSerial(uid), url] as const);
}
