import { formatEventDateTime } from '@/lib/domain/event-time';
import { escapeHtml } from '@/lib/domain/html';
import type { RenderedEmail } from './pass';

export interface RsvpEmailInput {
  firstName: string;
  event: { name: string; venue: string; startsAt: string; timezone: string };
  rsvpUrl: string;
  /** When the invitation stops taking a Yes (v0.9); null: no deadline. */
  closesAt: string | null;
  /** One of the reminders before the deadline (F13). */
  reminder?: boolean;
}

// SPEC F13 / §12: the invitation. The link carries the RSVP token only in the fragment (I-3).
export function renderRsvpEmail(input: RsvpEmailInput): RenderedEmail {
  const when = formatEventDateTime(input.event.startsAt, input.event.timezone);
  const by = input.closesAt ? formatEventDateTime(input.closesAt, input.event.timezone) : null;
  const deadline = by ? `Please reply by ${by}. No reply by then counts as a no, and your spot goes to someone on the waitlist.` : null;
  const yes = "If you say yes, you'll set a password for your Passline account and we'll email your check-in pass. Then set up your profile (emergency contact, overnight stay, allergies, team).";
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
<p>${input.reminder ? `A reminder: you're invited to <strong>${e.event}</strong>, and we haven't heard back yet.` : `You're invited to <strong>${e.event}</strong>.`} Will you be there?</p>
<p><strong>When:</strong> ${e.when}<br><strong>Where:</strong> ${e.venue}</p>
${by ? `<p><strong>Please reply by ${escapeHtml(by)}.</strong> No reply by then counts as a no, and your spot goes to someone on the waitlist.</p>\n` : ''}<p><a href="${e.url}" style="display:inline-block;padding:12px 20px;background:#111111;color:#ffffff;border-radius:10px;text-decoration:none">Reply to the invitation</a></p>
<p>${escapeHtml(yes)}</p>
<p>Questions? Just reply to this email.</p>
<p style="font-size:12px;color:#555555">We use your details only to run ${e.event}: admission, meals, attendance and emergencies. Dietary notes and emergency contacts are deleted 30 days after the event.</p>
</body></html>`;

  const text = [
    `Hi ${input.firstName},`,
    '',
    input.reminder ? `A reminder: you're invited to ${input.event.name}, and we haven't heard back yet. Will you be there?` : `You're invited to ${input.event.name}. Will you be there?`,
    '',
    `When: ${when}`,
    `Where: ${input.event.venue}`,
    '',
    ...(deadline ? [deadline, ''] : []),
    `Reply to the invitation: ${input.rsvpUrl}`,
    '',
    yes,
    '',
    'Questions? Just reply to this email.',
    '',
    `We use your details only to run ${input.event.name}: admission, meals, attendance and emergencies. Dietary notes and emergency contacts are deleted 30 days after the event.`,
  ].join('\n');

  const subject = input.reminder && by
    ? `Reminder: reply by ${by.split(' · ')[0] ?? by} — ${input.event.name}`
    : `You're invited: ${input.event.name} — will you be there?`;
  return { subject, html, text, inlineImages: [] };
}
