// Supabase Auth's local mail (invite and password-reset links) lands in Mailpit. This is Supabase Auth's
// mail, not our EmailProvider, so reading it is not "calling a real email provider".
const MAILPIT = 'http://127.0.0.1:54324';

interface MailpitList {
  messages: Array<{ ID: string; To: Array<{ Address: string }>; Created: string; Subject: string }>;
}

async function messagesTo(email: string, sinceMs: number) {
  const res = await fetch(`${MAILPIT}/api/v1/search?query=${encodeURIComponent(`to:"${email}"`)}`);
  return ((await res.json()) as MailpitList).messages.filter((m) => Date.parse(m.Created) >= sinceMs - 2000);
}

// The newest "set your password" link (invite or recovery) sent to `email` since `sinceMs`.
export async function latestAuthLink(email: string, sinceMs: number, timeoutMs = 15_000): Promise<{ url: string; subject: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const msg = (await messagesTo(email, sinceMs))[0];
    if (msg) {
      const full = (await (await fetch(`${MAILPIT}/api/v1/message/${msg.ID}`)).json()) as { HTML: string };
      const link = /https?:\/\/[^\s"'<>]+\/auth\/confirm\?[^\s"'<>]+#[^\s"'<>]+/.exec(full.HTML)?.[0];
      if (link) return { url: link.replaceAll('&amp;', '&'), subject: msg.Subject };
    }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('auth email did not arrive');
}

// For "nothing was sent": waits a moment, then counts.
export async function countMailTo(email: string, sinceMs: number, waitMs = 2_000): Promise<number> {
  await new Promise((r) => setTimeout(r, waitMs));
  return (await messagesTo(email, sinceMs)).length;
}
