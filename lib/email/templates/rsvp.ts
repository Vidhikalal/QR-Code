import { formatEventDateTime } from '@/lib/domain/event-time';
import { escapeHtml } from '@/lib/domain/html';
import type { RenderedEmail } from './pass';

export interface RsvpEmailInput {
  firstName: string;
  event: { name: string; venue: string; startsAt: string; timezone: string };
  rsvpUrl: string;
}

// SPEC F13 / §12 (v0.4): the invitation. The link carries the RSVP token only in the fragment (I-3).
export function renderRsvpEmail(input: RsvpEmailInput): RenderedEmail {
  const when = formatEventDateTime(input.event.startsAt, input.event.timezone);
  const e = {
    first: escapeHtml(input.firstName),
    event: escapeHtml(input.event.name),
    when: escapeHtml(when),
    venue: escapeHtml(input.event.venue),
    url: escapeHtml(input.rsvpUrl),
  };

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ffffff;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<p>Hi ${e.first},</p>
<p>You're invited to <strong>${e.event}</strong>. Will you be there?</p>
<p><strong>When:</strong> ${e.when}<br><strong>Where:</strong> ${e.venue}</p>
<p><a href="${e.url}" style="display:inline-block;padding:12px 20px;background:#111111;color:#ffffff;border-radius:10px;text-decoration:none">Reply to the invitation</a></p>
<p>If you say yes, you'll set a password for your Passline account and we'll email your check-in pass.</p>
<p>Questions? Just reply to this email.</p>
<p style="font-size:12px;color:#555555">We use your details only to run ${e.event}: admission, meals and attendance.</p>
</body></html>`;

  const text = [
    `Hi ${input.firstName},`,
    '',
    `You're invited to ${input.event.name}. Will you be there?`,
    '',
    `When: ${when}`,
    `Where: ${input.event.venue}`,
    '',
    `Reply to the invitation: ${input.rsvpUrl}`,
    '',
    "If you say yes, you'll set a password for your Passline account and we'll email your check-in pass.",
    '',
    'Questions? Just reply to this email.',
    '',
    `We use your details only to run ${input.event.name}: admission, meals and attendance.`,
  ].join('\n');

  return { subject: `You're invited: ${input.event.name} — will you be there?`, html, text, inlineImages: [] };
}
