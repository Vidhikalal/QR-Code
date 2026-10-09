import type { Page } from '@playwright/test';

// Playwright can't emulate NFC (PLAN §11.2). This replaces only the browser API: a stub NDEFReader
// whose `reading` events the test fires with window.__nfcTap(serial, url). lib/nfc/web-nfc.ts runs
// unchanged against it. window.__nfc.writes records written URLs; __nfc.failWrite makes writes fail.
export async function installFakeNfc(page: Page): Promise<void> {
  await page.addInitScript(() => {
    type Rec = { recordType: string; data: Uint8Array };
    const state = { readers: [] as EventTarget[], writes: [] as string[], failWrite: false };
    class FakeNDEFReader extends EventTarget {
      async scan() {
        state.readers.push(this);
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
  });
}

/** "04A23B…" → "04:a2:3b:…", the way Web NFC reports serials. */
export const webNfcSerial = (uid: string) => (uid.match(/../g) ?? []).join(':').toLowerCase();

export async function tap(page: Page, uid: string, url: string | null): Promise<void> {
  await page.evaluate(([serial, u]) => (window as unknown as { __nfcTap: (s: string, u: string | null) => void }).__nfcTap(serial ?? '', u ?? null), [webNfcSerial(uid), url] as const);
}
