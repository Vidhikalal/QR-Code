import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { writeUniqueFile } from '@/lib/dev/files';
import { toFileLabel } from '@/lib/domain/file-label';
import { ProviderError, type EmailMessage, type EmailProvider } from './provider';

const LOCAL_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

// "Passline <passes@localhost>" → { Email, Name }
function address(raw: string): { Email: string; Name?: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(raw);
  return m?.[2] ? { Email: m[2], ...(m[1] ? { Name: m[1].replace(/^"|"$/g, '') } : {}) } : { Email: raw.trim() };
}

// Dev provider: delivers to the local Mailpit inbox (http://127.0.0.1:54324, started by `supabase
// start`) through its send API, so pass and profile emails look as they will in a real inbox. The QR
// is an inline cid: image as with real providers, and is also saved to .mail/qr/<Event>-<First>.png
// like the console provider. Refuses any non-local URL: it can never reach a real inbox (CLAUDE.md).
export function createMailpitProvider(opts: { url: string; dir?: string }): EmailProvider {
  const base = new URL(opts.url);
  if (!LOCAL_HOSTS.has(base.hostname)) throw new Error('MAILPIT_URL must be local (127.0.0.1 or localhost)');
  const dir = opts.dir ?? join(process.cwd(), '.mail');
  return {
    name: 'mailpit',
    async send(message: EmailMessage) {
      const res = await fetch(new URL('/api/v1/send', base).toString(), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          From: address(message.from),
          To: [address(message.to)],
          Subject: message.subject,
          Text: message.text,
          HTML: message.html,
          Attachments: message.inlineImages.map((img) => ({
            Content: img.content.toString('base64'),
            Filename: img.filename,
            ContentType: img.contentType,
            ContentID: img.cid,
          })),
          Headers: { 'X-Idempotency-Key': message.idempotencyKey },
        }),
      }).catch(() => null);
      // No response text in the error: it can echo the recipient (I-11).
      if (!res?.ok) throw new ProviderError(`mailpit send failed (${res?.status ?? 'network'})`, res?.status ?? 0);
      const data = (await res.json().catch(() => ({}))) as { ID?: string };
      const label = toFileLabel(message.fileLabel ?? '');
      for (const img of message.inlineImages) {
        if (img.contentType === 'image/png') await writeUniqueFile(join(dir, 'qr'), label, '.png', img.content);
      }
      return { id: `mailpit-${data.ID ?? randomUUID()}` };
    },
  };
}
