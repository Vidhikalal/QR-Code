import { escapeHtml } from '@/lib/domain/html';
import type { RenderedEmail } from './pass';

export interface ProfileLinkEmailInput {
  firstName: string;
  eventName: string;
  /** `${ME_ORIGIN}/edit#${key}` with a key issued (and committed) just for this email. */
  editUrl: string;
}

// PLAN §12.2: "This is me", "Email me a sign-in link" and "Get a new link" all send this.
export function renderProfileLinkEmail(input: ProfileLinkEmailInput): RenderedEmail {
  const e = { first: escapeHtml(input.firstName), event: escapeHtml(input.eventName), edit: escapeHtml(input.editUrl) };
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ffffff;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<p>Hi ${e.first},</p>
<p>Here is your sign-in link for your <strong>${e.event}</strong> profile.</p>
<p><a href="${e.edit}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:8px">Open my profile</a></p>
<p style="font-size:14px">This link is personal. Anyone with it can edit your profile.</p>
<p style="font-size:14px;color:#555555">If you didn't ask for this, you can ignore it.</p>
</body></html>`;
  const text = [
    `Hi ${input.firstName},`,
    '',
    `Here is your sign-in link for your ${input.eventName} profile:`,
    input.editUrl,
    '',
    'This link is personal. Anyone with it can edit your profile.',
    "If you didn't ask for this, you can ignore it.",
  ].join('\n');
  return { subject: `Your ${input.eventName} profile link`, html, text, inlineImages: [] };
}
