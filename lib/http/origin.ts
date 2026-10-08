// PLAN I-23 / §9.2: every participant mutation on the ME host must come from the ME origin. With the
// SameSite=Lax cookie this stops cross-site form posts and fetches (CSRF). A missing Origin fails too.
export function fromOrigin(request: Request, origin: string): boolean {
  return request.headers.get('origin') === origin;
}
