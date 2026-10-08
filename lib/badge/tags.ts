import { parseCsv } from '@/lib/domain/csv';

// PLAN §11.3. Pure and client-safe: the scanner and the Register page parse tag contents in the browser.

const PUBLIC_ID = /^[A-Za-z0-9_-]{12}$/;
const MAX_LENGTH = 2048;

export const tagUrl = (meOrigin: string, publicId: string) => `${meOrigin}/t/${publicId}`;

/** Exactly `${meOrigin}/t/<12 chars>`, with an optional trailing slash. Never throws. */
export function parseTagUrl(raw: string, meOrigin: string): { ok: true; publicId: string } | { ok: false } {
  if (typeof raw !== 'string' || raw.length > MAX_LENGTH) return { ok: false };
  const text = raw.trim().replace(/\/$/, '');
  const prefix = `${meOrigin}/t/`;
  if (!text.startsWith(prefix)) return { ok: false };
  const id = text.slice(prefix.length);
  return PUBLIC_ID.test(id) ? { ok: true, publicId: id } : { ok: false };
}

export const isPublicId = (v: string) => PUBLIC_ID.test(v);

/** A chip serial as uppercase hex without separators (Web NFC gives "04:a2:…"), or null. */
export function normalizeUid(raw: string): string | null {
  if (typeof raw !== 'string') return null;
  const hex = raw.replace(/[\s:-]/g, '').toUpperCase();
  if (!/^[0-9A-F]+$/.test(hex) || hex.length % 2 !== 0 || hex.length < 8 || hex.length > 20) return null;
  return hex;
}

export type TagCsvRow = { row: number; publicId: string; uid: string; label: string | null } | { row: number; error: 'public_id' | 'uid' | 'label' };

// Vendor list (PLAN F19 B): a header with `url` or `public_id`, `uid`, and optionally `label`.
export function parseTagCsv(text: string, meOrigin: string): { ok: true; rows: TagCsvRow[] } | { ok: false; error: 'header' } {
  const [header, ...body] = parseCsv(text);
  const cols = (header ?? []).map((h) => h.trim().toLowerCase());
  const urlCol = cols.indexOf('url');
  const idCol = cols.indexOf('public_id');
  const uidCol = cols.indexOf('uid');
  const labelCol = cols.indexOf('label');
  if ((urlCol < 0 && idCol < 0) || uidCol < 0) return { ok: false, error: 'header' };
  const rows = body.map((cells, i): TagCsvRow => {
    const row = i + 1;
    const cell = (c: number) => (c >= 0 ? (cells[c] ?? '').trim() : '');
    const publicId = idCol >= 0 && cell(idCol) ? (isPublicId(cell(idCol)) ? cell(idCol) : null) : (() => {
      const parsed = parseTagUrl(cell(urlCol), meOrigin);
      return parsed.ok ? parsed.publicId : null;
    })();
    if (!publicId) return { row, error: 'public_id' };
    const uid = normalizeUid(cell(uidCol));
    if (!uid) return { row, error: 'uid' };
    const label = cell(labelCol);
    if (label.length > 20) return { row, error: 'label' };
    return { row, publicId, uid, label: label || null };
  });
  return { ok: true, rows };
}
