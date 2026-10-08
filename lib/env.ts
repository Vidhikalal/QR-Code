import 'server-only';
import { z } from 'zod';

// SPEC §19. Parsed once, on first use; any problem throws with every bad key listed.
export const serverEnvSchema = z
  .object({
    NEXT_PUBLIC_APP_ORIGIN: z.url().refine((u) => new URL(u).origin === u, 'must be a bare origin, no trailing slash'),
    // PLAN §5.1: the staff host. Defaults to NEXT_PUBLIC_APP_ORIGIN (single host in dev).
    NEXT_PUBLIC_ADMIN_ORIGIN: z.url().refine((u) => new URL(u).origin === u, 'must be a bare origin, no trailing slash').optional(),
    // Parent domain shared by both hosts, e.g. ".yourclub.ca", so staff sessions reach the ME host.
    NEXT_PUBLIC_AUTH_COOKIE_DOMAIN: z.string().regex(/^\.?[a-z0-9.-]+$/, 'a domain like .yourclub.ca').optional(),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
    NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
    SUPABASE_SERVICE_ROLE_KEY: z.string().min(1),
    SHEET_INGEST_SECRET: z.string().min(32, 'must be at least 32 characters'),
    DRAIN_SECRET: z.string().min(32, 'must be at least 32 characters'),
    GOOGLE_SERVICE_ACCOUNT_JSON: z.string().min(1).optional(),
    EMAIL_PROVIDER: z.enum(['console', 'resend']),
    RESEND_API_KEY: z.string().min(1).optional(),
    EMAIL_FROM: z.string().min(3).optional(),
    // PLAN §5.2: participant session lifetime on the ME host.
    PARTICIPANT_SESSION_DAYS: z.coerce.number().int().min(1).max(365).default(30),
    // PLAN §2.3: a flagged-off feature has no routes (404) and no UI.
    FEATURE_EXTRA_BADGE_ROLES: z.stringbool().default(false),
    FEATURE_HUNT: z.stringbool().default(false),
    FEATURE_SHIFTS: z.stringbool().default(false),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === 'resend') {
      for (const key of ['RESEND_API_KEY', 'EMAIL_FROM'] as const) {
        if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'required when EMAIL_PROVIDER=resend' });
      }
    }
  });

export type ServerEnv = z.infer<typeof serverEnvSchema>;

/** The staff (ADMIN) origin: NEXT_PUBLIC_ADMIN_ORIGIN, else the ME origin. */
export const adminOrigin = (e: ServerEnv): string => e.NEXT_PUBLIC_ADMIN_ORIGIN ?? e.NEXT_PUBLIC_APP_ORIGIN;

export function parseServerEnv(source: Record<string, string | undefined>): ServerEnv {
  // Empty strings in .env files mean "unset".
  const cleaned = Object.fromEntries(Object.entries(source).filter(([, v]) => v !== undefined && v !== ''));
  const result = serverEnvSchema.safeParse(cleaned);
  if (!result.success) {
    // Only key names and messages; never values (they are secrets).
    const problems = result.error.issues.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment:\n${problems}`);
  }
  return result.data;
}

let cached: ServerEnv | undefined;

export function env(): ServerEnv {
  cached ??= parseServerEnv(process.env);
  return cached;
}
