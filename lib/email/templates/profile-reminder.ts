import { escapeHtml } from '@/lib/domain/html';
import type { RenderedEmail } from './pass';

export interface ProfileReminderEmailInput {
  firstName: string;
  event: string;
  appOrigin: string;
}

// SPEC F14 / §12 (v0.9): two days before the event, to accepted hackers who haven't finished their profile.
// No token: the link opens their signed-in menu.
export function renderProfileReminderEmail(input: ProfileReminderEmailInput): RenderedEmail {
  const url = `${input.appOrigin}/me/profile`;
  const ask = "Your emergency contact, whether you're staying overnight, allergies, your team and any accessibility needs. It takes a minute.";
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ffffff;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<p>Hi ${escapeHtml(input.firstName)},</p>
<p>Please finish setting up your profile before <strong>${escapeHtml(input.event)}</strong>.</p>
<p>${escapeHtml(ask)}</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#111111;color:#ffffff;border-radius:10px;text-decoration:none">Set up your profile</a></p>
<p>Questions? Just reply to this email.</p>
</body></html>`;
  const text = [`Hi ${input.firstName},`, '', `Please finish setting up your profile before ${input.event}.`, '', ask, '', `Set up your profile: ${url}`, '', 'Questions? Just reply to this email.'].join('\n');
  return { subject: `Finish setting up your profile for ${input.event}`, html, text, inlineImages: [] };
}
