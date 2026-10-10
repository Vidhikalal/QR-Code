import { escapeHtml } from '@/lib/domain/html';
import type { RenderedEmail } from '@/lib/email/templates/pass';

// PLAN §12.4 (Q5 default): the organizer's message with placeholders, a fixed stats block, the
// connections link and the badge unlock password. Pure: the drainer and the preview both call it.

export interface RecapStats {
  workshops: number;
  activities: number;
  connections: number;
  activityPoints: number;
  networkingPoints: number;
}

export interface RecapInput {
  firstName: string;
  nickname: string | null;
  eventName: string;
  /** events.recap_message; null → DEFAULT_RECAP_MESSAGE */
  message: string | null;
  stats: RecapStats;
  /** `${ME_ORIGIN}/edit?next=/me/connections#${key}` (a fresh, committed key), or a preview placeholder. */
  connectionsUrl: string;
  unlockPassword: string | null;
}

export const RECAP_PLACEHOLDERS = [
  '{nickname}',
  '{first_name}',
  '{event}',
  '{workshops}',
  '{activities}',
  '{connections}',
  '{activity_points}',
  '{networking_points}',
] as const;
export const RECAP_MESSAGE_MAX = 2000;
export const DEFAULT_RECAP_MESSAGE =
  "Thanks for coming to {event}, {nickname}! You attended {workshops} workshops and made {connections} connections. We can't wait to see you at our next event.";

const TOKEN = /\{[^{}\s]*\}/g;
const KNOWN = new Set<string>(RECAP_PLACEHOLDERS);

export type RecapValidation = { ok: true } | { ok: false; unknown: string[] } | { ok: false; tooLong: true };

export function validateRecapMessage(message: string): RecapValidation {
  if (message.length > RECAP_MESSAGE_MAX) return { ok: false, tooLong: true };
  const unknown = [...new Set(message.match(TOKEN) ?? [])].filter((t) => !KNOWN.has(t));
  return unknown.length > 0 ? { ok: false, unknown } : { ok: true };
}

function values(input: RecapInput): Record<string, string> {
  const s = input.stats;
  return {
    '{nickname}': input.nickname?.trim() || input.firstName,
    '{first_name}': input.firstName,
    '{event}': input.eventName,
    '{workshops}': String(s.workshops),
    '{activities}': String(s.activities),
    '{connections}': String(s.connections),
    '{activity_points}': String(s.activityPoints),
    '{networking_points}': String(s.networkingPoints),
  };
}

const fill = (template: string, v: Record<string, string>, wrap: (s: string) => string) =>
  template.replace(TOKEN, (t) => (t in v ? wrap(v[t] ?? '') : t));

const UNLOCK_STEPS = [
  'Install the free NFC Tools app on your phone.',
  'In its options for passwords, remove the password from your badge using the one above.',
  'Write anything you like to it: your own link, a contact card, or nothing at all.',
];

export function renderRecapEmail(input: RecapInput): RenderedEmail {
  const v = values(input);
  const message = input.message ?? DEFAULT_RECAP_MESSAGE;
  const s = input.stats;
  const statLines: Array<[string, number]> = [
    ['Workshops', s.workshops],
    ['Activities', s.activities],
    ['Connections', s.connections],
    ['Activity points', s.activityPoints],
    ['Networking points', s.networkingPoints],
  ];
  const e = { event: escapeHtml(input.eventName), url: escapeHtml(input.connectionsUrl), password: input.unlockPassword && escapeHtml(input.unlockPassword) };
  const bodyHtml = fill(escapeHtml(message), v, escapeHtml).replace(/\r?\n/g, '<br>');

  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;background:#ffffff;color:#111111;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.5">
<p>${bodyHtml}</p>
<h2 style="font-size:18px;margin:24px 0 8px">Your ${e.event} in numbers</h2>
<table role="presentation" style="border-collapse:collapse">
${statLines.map(([label, n]) => `<tr><td style="padding:2px 16px 2px 0">${label}</td><td style="padding:2px 0;font-weight:bold">${n}</td></tr>`).join('\n')}
</table>
<p style="margin-top:24px"><a href="${e.url}" style="display:inline-block;padding:10px 16px;background:#1d4ed8;color:#ffffff;text-decoration:none;border-radius:8px">See your connections</a></p>
<p style="font-size:14px">This link is personal. Anyone with it can edit your profile.</p>
${
  e.password
    ? `<h2 style="font-size:18px;margin:24px 0 8px">Unlock your badge</h2>
<p>Your badge is yours to keep. Its password is <strong style="font-family:monospace;font-size:18px">${e.password}</strong></p>
<ol>${UNLOCK_STEPS.map((step) => `<li>${escapeHtml(step)}</li>`).join('')}</ol>`
    : ''
}
</body></html>`;

  const text = [
    fill(message, v, (x) => x),
    '',
    `Your ${input.eventName} in numbers:`,
    ...statLines.map(([label, n]) => `- ${label}: ${n}`),
    '',
    `See your connections: ${input.connectionsUrl}`,
    'This link is personal. Anyone with it can edit your profile.',
    ...(input.unlockPassword
      ? ['', 'Unlock your badge', `Your badge is yours to keep. Its password is: ${input.unlockPassword}`, ...UNLOCK_STEPS.map((step, i) => `${i + 1}. ${step}`)]
      : []),
  ].join('\n');

  return { subject: `Thanks for coming to ${input.eventName}!`, html, text, inlineImages: [] };
}
