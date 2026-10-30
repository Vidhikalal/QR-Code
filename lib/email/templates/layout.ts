import { escapeHtml } from '@/lib/domain/html';
// SPEC §12: the app's Datathon look (navy, terminal green, Fira Code) in email-safe HTML. Tables with bgcolor so
// Outlook keeps the colours, inline styles only, and a monospace fallback because mail apps rarely load web fonts.
// Every argument is HTML the caller has already escaped.
const FONT = "'Fira Code',Menlo,Consolas,'Courier New',monospace";
const C = { bg: '#05081a', card: '#0a1029', raised: '#0c1330', line: '#222d47', fg: '#e8f2ff', muted: '#8fa0c4', accent: '#34d399', ink: '#03120c', link: '#b8dcff' };

export const HEADLINE = `font-size:20px;line-height:1.35;font-weight:600;color:${C.fg}`;
export const MUTED = `color:${C.muted}`;

export const p = (html: string, style = '') => `<p style="margin:0 0 16px;${style}">${html}</p>`;

export const link = (href: string, text: string) => `<a href="${href}" style="color:${C.link};text-decoration:underline">${text}</a>`;

export const list = (items: string[]) =>
  `<ul style="margin:0 0 16px;padding-left:20px;color:${C.muted}">${items.map((i) => `<li style="margin:0 0 4px">${i}</li>`).join('')}</ul>`;

// Buttons and the QR sit centred: align="center" for older mail apps, margin auto for the rest.
const centred = (top: string) => ` align="center" style="border-spacing:0;margin:${top} auto 20px`;

export function button(href: string, text: string, kind: 'primary' | 'secondary' = 'primary'): string {
  const [bg, fg, border] = kind === 'primary' ? [C.accent, C.ink, C.accent] : [C.raised, C.fg, C.line];
  return `<table role="none" border="0"${centred('4px')}"><tr><td bgcolor="${bg}" style="padding:0;background:${bg};border:1px solid ${border};border-radius:6px"><a href="${href}" style="display:inline-block;padding:12px 20px;font-family:${FONT};font-size:15px;font-weight:600;line-height:1.2;color:${fg};text-decoration:none">${text}</a></td></tr></table>`;
}

/** When/Where rows in a raised box, like the event line on the app's RSVP card. */
export const details = (rows: [string, string][]) =>
  `<table role="none" width="100%" border="0" style="border-spacing:0;margin:0 0 20px"><tr><td bgcolor="${C.raised}" style="background:${C.raised};border:1px solid ${C.line};border-radius:6px;padding:12px 16px">${rows
    .map(([k, v], i) => `<p style="margin:${i ? '6px' : '0'} 0 0"><span style="color:${C.muted}">${k}:</span> ${v}</p>`)
    .join('')}</td></tr></table>`;

/** The QR on an opaque white card: a dark background around the code would stop it scanning (§6.2). */
export const qr = (img: string) =>
  `<table role="none" border="0"${centred('0')}"><tr><td bgcolor="#ffffff" style="background:#ffffff;border-radius:8px;padding:12px">${img}</td></tr></table>`;

/** The admin header's mark: the logo, DATATHON, a divider and what this email is (where the app says EVENT CONSOLE).
 *  The logo is served by the app (public/email-logo.png), not attached: mail apps that block images show its alt text. */
const brand = (origin: string, label: string) =>
  `<table role="none" border="0" style="border-spacing:0"><tr><td width="36" style="padding:0;width:36px"><img src="${escapeHtml(origin)}/email-logo.png" width="36" height="36" alt="Sheridan Datathon" style="display:block;width:36px;height:36px;border:0"></td><td style="padding:0 0 0 10px;font-size:11px;font-weight:700;letter-spacing:0.13em;color:${C.fg}">DATATHON</td><td style="padding:0 10px"><div style="width:1px;height:14px;background:#1e263a"></div></td><td style="padding:0;font-size:11px;font-weight:700;letter-spacing:0.13em;color:${C.muted}">${label.toUpperCase()}</td></tr></table>`;

/** A whole email: the Datathon mark, one card holding the body, and optional small print under it. */
export function emailPage(origin: string, label: string, body: string, footer = ''): string {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background:${C.bg}" bgcolor="${C.bg}">
<table role="none" width="100%" border="0" bgcolor="${C.bg}" style="border-spacing:0;background:${C.bg}"><tr><td align="center" style="padding:32px 16px">
<table role="none" width="100%" border="0" style="border-spacing:0;max-width:560px;font-family:${FONT};font-size:15px;line-height:1.6;color:${C.fg}">
<tr><td style="padding:0 2px 14px">${brand(origin, label)}</td></tr>
<tr><td bgcolor="${C.card}" style="background:${C.card};border:1px solid ${C.line};border-radius:8px;padding:28px 24px">
${body}
</td></tr>
${footer ? `<tr><td style="padding:16px 2px 0;font-size:12px;line-height:1.6;color:${C.muted}">${footer}</td></tr>\n` : ''}</table>
</td></tr></table>
</body></html>`;
}
