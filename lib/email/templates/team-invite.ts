import { escapeHtml } from '@/lib/domain/html';
import type { RenderedEmail } from './pass';

export interface TeamInviteEmailInput {
  firstName: string;
  inviter: string;
  team: string;
  event: string;
  appOrigin: string;
}

// SPEC F15 / §12 (S11b): consent happens on the Team page; no join code or token travels in email.
export function renderTeamInviteEmail(input: TeamInviteEmailInput): RenderedEmail {
  const url = `${input.appOrigin}/me/team`;
  const sentence = `${input.inviter} invited you to join ${input.team} at ${input.event}`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ffffff;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<p>Hi ${escapeHtml(input.firstName)},</p>
<p>${escapeHtml(sentence)}.</p>
<p><a href="${escapeHtml(url)}" style="display:inline-block;padding:12px 20px;background:#111111;color:#ffffff;border-radius:10px;text-decoration:none">Open your Team page</a></p>
<p>Questions? Just reply to this email.</p>
</body></html>`;
  const text = [`Hi ${input.firstName},`, '', `${sentence}.`, '', `Open your Team page: ${url}`, '', 'Questions? Just reply to this email.'].join('\n');
  return { subject: sentence, html, text, inlineImages: [] };
}
