// PLAN F17.3 / A-SESS-2: an email or social app's built-in browser keeps its own cookies, so a
// session opened there isn't seen when a badge tap opens Safari or Chrome. Returns the app's name
// for the banner, or null for a real browser.
const APPS: Array<[RegExp, string]> = [
  [/\bGmail\//, 'Gmail'],
  [/\bOutlook-(iOS|Android)\//, 'Outlook'],
  [/\bInstagram\b/, 'Instagram'],
  [/\[LinkedInApp\]|\bLinkedInApp\b/, 'LinkedIn'],
  [/\bFBAN\/|\bFBAV\/|\bFB_IAB\//, 'Facebook'],
  [/\bGSA\//, 'Google'],
  [/; wv\)/, 'an app'], // Android WebView
];

export function isInAppBrowser(userAgent: string | null | undefined): string | null {
  if (!userAgent) return null;
  for (const [pattern, name] of APPS) if (pattern.test(userAgent)) return name;
  return null;
}
