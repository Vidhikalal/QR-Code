import type { SupabaseClient } from '@supabase/supabase-js';
import sharp from 'sharp';
import type { Database } from '@/lib/db/types.gen';
import { sniffImage } from '@/lib/domain/image';
import { PHOTO_BUCKET, photoPath } from '@/lib/storage/photos';

type Db = SupabaseClient<Database>;

const MB = 1024 * 1024;
export const MAX_PHOTO_BYTES = 8 * MB;
export const MAX_PHOTO_REQUEST_BYTES = MAX_PHOTO_BYTES + 64 * 1024; // multipart overhead
const MAX_INPUT_PIXELS = 60_000_000; // generous for 48 MP phones; stops decompression bombs

export type PhotoResult = { ok: true; photoUpdatedAt: string } | { ok: false; status: 413 | 415; error: 'too_large' | 'unsupported_type' };

// SPEC F5 pipeline, shared by /api/pass/photo (token) and /api/me/photo (session). Callers authorize,
// rate-limit and check the check-in lock first. Magic bytes decide the type, never the name or MIME.
export async function storeParticipantPhoto(db: Db, who: { eventId: string; participantId: string }, file: File): Promise<PhotoResult> {
  if (file.size > MAX_PHOTO_BYTES) return { ok: false, status: 413, error: 'too_large' };
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!sniffImage(bytes)) return { ok: false, status: 415, error: 'unsupported_type' };

  let output: Buffer;
  try {
    // .rotate() applies EXIF orientation BEFORE metadata is stripped (sharp strips by default).
    output = await sharp(bytes, { limitInputPixels: MAX_INPUT_PIXELS }).rotate().resize(512, 512, { fit: 'cover' }).jpeg({ quality: 80 }).toBuffer();
  } catch {
    return { ok: false, status: 415, error: 'unsupported_type' };
  }

  const path = photoPath(who.eventId, who.participantId);
  const upload = await db.storage.from(PHOTO_BUCKET).upload(path, output, { contentType: 'image/jpeg', upsert: true });
  if (upload.error) throw new Error(`photo upload failed (${upload.error.name})`);
  const photoUpdatedAt = new Date().toISOString();
  const { error } = await db.from('participants').update({ photo_path: path, photo_updated_at: photoUpdatedAt }).eq('id', who.participantId);
  if (error) throw new Error(`photo_path update failed (${error.code})`);
  return { ok: true, photoUpdatedAt };
}

/** A live door scan locks the photo (SPEC F5). */
export async function isCheckedIn(db: Db, participantId: string): Promise<boolean> {
  const { count, error } = await db
    .from('scans')
    .select('id, checkpoints!inner(kind)', { count: 'exact', head: true })
    .eq('participant_id', participantId)
    .eq('checkpoints.kind', 'door')
    .is('voided_at', null);
  if (error) throw new Error(`check-in lookup failed (${error.code})`);
  return (count ?? 0) > 0;
}
