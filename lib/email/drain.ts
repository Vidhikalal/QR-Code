import { randomUUID } from 'node:crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/db/types.gen';
import { toFileLabel } from '@/lib/domain/file-label';
import { nextAttempt, sanitizeError } from '@/lib/domain/outbox';
import { generateToken, passToken, sha256hex } from '@/lib/domain/token';
import { renderQrPng } from '@/lib/qr/render';
import { ProviderError, type EmailProvider } from './provider';
import { renderPassEmail, type RenderedEmail } from './templates/pass';
import { renderRsvpEmail } from './templates/rsvp';

type Db = SupabaseClient<Database>;
type OutboxRow = Database['public']['Tables']['email_outbox']['Row'];
type FinishArgs = Database['public']['Functions']['finish_outbox']['Args'];

export interface DrainOptions {
  db: Db;
  provider: EmailProvider;
  appOrigin: string;
  from: string;
  /** PASS_TOKEN_SECRET (§6.1). */
  passSecret: string;
  limit?: number;
  now?: () => Date;
}

export interface DrainResult {
  claimed: number;
  sent: number;
  retrying: number;
  failed: number;
  cancelled: number;
}

// SPEC F4. Safe to run concurrently: rows are claimed with FOR UPDATE SKIP LOCKED.
export async function drainOutbox(opts: DrainOptions): Promise<DrainResult> {
  const { data: rows, error } = await opts.db.rpc('claim_outbox', { p_limit: opts.limit ?? 20 });
  if (error) throw new Error(`claim_outbox failed (${error.code})`);
  const result: DrainResult = { claimed: rows.length, sent: 0, retrying: 0, failed: 0, cancelled: 0 };
  for (const row of rows) result[await processRow(opts, row)] += 1;
  return result;
}

// Drains batch after batch until nothing is due or the time budget is spent (after() / cron runs).
export async function drainUntilIdle(opts: DrainOptions, budgetMs = 25_000): Promise<number> {
  const deadline = Date.now() + budgetMs;
  let claimed = 0;
  for (;;) {
    const r = await drainOutbox(opts);
    claimed += r.claimed;
    if (r.claimed === 0 || Date.now() > deadline) return claimed;
  }
}

async function finish(db: Db, args: FinishArgs): Promise<void> {
  const { error } = await db.rpc('finish_outbox', args);
  if (error) throw new Error(`finish_outbox failed (${error.code})`);
}

async function processRow(opts: DrainOptions, row: OutboxRow): Promise<Exclude<keyof DrainResult, 'claimed'>> {
  let providerId: string;
  try {
    // 1. Reload the participant; stop if they were deleted, or (for a pass) are no longer accepted,
    // or (for an RSVP, F13) already are.
    const { data: p, error } = await opts.db
      .from('participants')
      .select('first_name, email, status, deleted_at, events(name, venue, starts_at, timezone)')
      .eq('id', row.participant_id)
      .single();
    if (error) throw new Error(`participant load failed (${error.code})`);
    const accepted = p.status === 'accepted';
    if (p.deleted_at !== null || (row.kind === 'rsvp' ? accepted : !accepted)) {
      await finish(opts.db, { p_id: row.id, p_status: 'cancelled' });
      return 'cancelled';
    }
    const event = { name: p.events.name, venue: p.events.venue, startsAt: p.events.starts_at, timezone: p.events.timezone };

    let email: RenderedEmail;
    if (row.kind === 'rsvp') {
      // 2. A fresh RSVP token, stored (hash only) BEFORE the send, like a pass (I-10); older links stop working.
      // Only while this job is still ours: an answer that cancelled it since the claim stops the resend.
      const token = generateToken();
      const { data: stillOurs, error: rsvpError } = await opts.db.rpc('set_rsvp_token', { p_outbox_id: row.id, p_token_hash: sha256hex(token) });
      if (rsvpError) throw new Error(`set_rsvp_token failed (${rsvpError.code})`);
      if (!stillOurs) {
        await finish(opts.db, { p_id: row.id, p_status: 'cancelled' });
        return 'cancelled';
      }
      email = renderRsvpEmail({ firstName: p.first_name, event, rsvpUrl: `${opts.appOrigin}/rsvp#${token}` });
    } else {
      // 2. Issue the pass. issue_pass() commits in its own transaction BEFORE the send (I-10).
      const passId = randomUUID();
      const token = passToken(opts.passSecret, passId);
      const { error: issueError } = await opts.db.rpc('issue_pass', {
        p_participant_id: row.participant_id,
        p_token_hash: sha256hex(token),
        p_pass_id: passId,
      });
      if (issueError) throw new Error(`issue_pass failed (${issueError.code})`);
      const passUrl = `${opts.appOrigin}/p#${token}`;
      email = renderPassEmail({ firstName: p.first_name, event, passUrl, qrPng: await renderQrPng(passUrl) });
    }

    // 3. Send.
    ({ id: providerId } = await opts.provider.send({
      to: p.email,
      from: opts.from,
      ...email,
      idempotencyKey: `${row.id}:${row.attempts}`,
      fileLabel: toFileLabel(p.events.name, p.first_name),
    }));
  } catch (err) {
    // 5. Failure: back off, or give up after the last attempt. last_error is sanitized (I-11).
    const next = nextAttempt({
      attempts: row.attempts,
      now: (opts.now ?? (() => new Date()))(),
      retryAfterSeconds: err instanceof ProviderError ? err.retryAfterSeconds : undefined,
    });
    const lastError = sanitizeError(err);
    if (next.status === 'failed') {
      await finish(opts.db, { p_id: row.id, p_status: 'failed', p_last_error: lastError });
      return 'failed';
    }
    await finish(opts.db, {
      p_id: row.id,
      p_status: 'pending',
      p_next_attempt_at: next.at.toISOString(),
      p_last_error: lastError,
    });
    return 'retrying';
  }

  // 4. Success. If this write fails, the row is retried and a second email goes out with a newer
  // code; only the newest works (accepted edge, SPEC F4).
  await finish(opts.db, { p_id: row.id, p_status: 'sent', p_provider_message_id: providerId });
  return 'sent';
}
