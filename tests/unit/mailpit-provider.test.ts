import { mkdtemp, readdir, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMailpitProvider } from '@/lib/email/mailpit';
import type { EmailMessage } from '@/lib/email/provider';
import { ProviderError } from '@/lib/email/provider';

// Dev only: deliver to the local Mailpit inbox (http://127.0.0.1:54324) through its send API.
afterEach(() => {
  vi.restoreAllMocks();
});

const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
const message = (o: Partial<EmailMessage> = {}): EmailMessage => ({
  to: 'ada@example.com',
  from: 'Passline <passes@localhost>',
  subject: "You're in: Hack Day — your check-in pass",
  html: '<p>Hi Ada</p><img src="cid:qr">',
  text: 'Hi Ada',
  inlineImages: [{ cid: 'qr', filename: 'passline-qr.png', contentType: 'image/png', content: png }],
  idempotencyKey: 'row-1:1',
  fileLabel: 'Hack-Day-Ada',
  ...o,
});

describe('Mailpit provider (dev)', () => {
  it('posts both parts and the QR as an inline cid: image to the send API, and saves the QR file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'passline-mailpit-'));
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json({ ID: 'abc123' }));
    const r = await createMailpitProvider({ url: 'http://127.0.0.1:54324', dir }).send(message());
    expect(r).toEqual({ id: 'mailpit-abc123' });
    const [url, init] = fetchSpy.mock.calls[0] ?? [];
    expect(url).toBe('http://127.0.0.1:54324/api/v1/send');
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
    expect(body).toMatchObject({
      From: { Email: 'passes@localhost', Name: 'Passline' },
      To: [{ Email: 'ada@example.com' }],
      Subject: "You're in: Hack Day — your check-in pass",
      Text: 'Hi Ada',
      HTML: '<p>Hi Ada</p><img src="cid:qr">',
      Attachments: [{ Content: png.toString('base64'), Filename: 'passline-qr.png', ContentType: 'image/png', ContentID: 'qr' }],
      Headers: { 'X-Idempotency-Key': 'row-1:1' },
    });
    expect(body).not.toHaveProperty('fileLabel');
    expect(await readdir(join(dir, 'qr'))).toEqual(['Hack-Day-Ada.png']);
    expect(await readFile(join(dir, 'qr', 'Hack-Day-Ada.png'))).toEqual(png);
  });

  it('a failed send is a ProviderError that never names the recipient', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom ada@example.com', { status: 500 }));
    const err = await createMailpitProvider({ url: 'http://127.0.0.1:54324', dir: await mkdtemp(join(tmpdir(), 'pm-')) })
      .send(message())
      .catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ProviderError);
    expect(String((err as Error).message)).not.toContain('ada@example.com');
  });

  it('refuses a non-local URL, so it can never reach a real inbox', () => {
    expect(() => createMailpitProvider({ url: 'https://mail.example.com' })).toThrow(/local/);
  });
});
