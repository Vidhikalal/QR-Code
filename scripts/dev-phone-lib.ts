// The quick-tunnel address cloudflared prints, e.g. https://defend-excessive-tower-lil.trycloudflare.com.
// Quick-tunnel names are hyphenated words; api.trycloudflare.com (in its logs) is not one.
export function parseTunnelUrl(output: string): string | null {
  return /https:\/\/(?!api\.)[a-z0-9]+(?:-[a-z0-9]+)+\.trycloudflare\.com/.exec(output)?.[0] ?? null;
}
