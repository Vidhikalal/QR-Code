import { z } from 'zod';
import { SCAN_CODES } from '@/lib/domain/scan-codes';

// SPEC §9.1 request body. Client-safe: the scanner builds requests with the same schema.
export const scanRequestSchema = z
  .object({
    checkpointId: z.uuid(),
    method: z.enum(['qr', 'manual', 'nfc']),
    token: z.string().regex(/^[A-Za-z0-9_-]{32}$/).optional(),
    participantId: z.uuid().optional(),
    // PLAN §9.1 (v2): a badge, by the id in its URL / printed QR, its chip serial, or both.
    tagPublicId: z.string().regex(/^[A-Za-z0-9_-]{12}$/).optional(),
    tagUid: z.string().max(64).optional(),
    // Meals: "Serve again" after REPEAT_SERVING (PLAN F22).
    confirmRepeat: z.boolean().optional(),
    clientScanId: z.uuidv4(),
    clientScannedAt: z.iso.datetime({ offset: true }),
  })
  .strict()
  .refine(
    (b) => {
      const tag = b.tagPublicId !== undefined || b.tagUid !== undefined;
      if (b.method === 'qr') return b.token !== undefined && b.participantId === undefined && !tag;
      if (b.method === 'manual') return b.participantId !== undefined && b.token === undefined && !tag;
      return tag && b.token === undefined && b.participantId === undefined;
    },
    { message: 'token iff qr, participantId iff manual, tagPublicId/tagUid iff nfc' },
  );

export type ScanRequest = z.infer<typeof scanRequestSchema>;

// §9.1 200-response, as the scanner client validates it. Anything that doesn't parse is treated as
// NETWORK (amber), so a proxy error page can never turn into a green screen (I-1).
export const scanResponseSchema = z.object({
  code: z.enum(SCAN_CODES),
  replayed: z.boolean().optional(),
  voided: z.boolean().optional(),
  scanId: z.string().optional(),
  participant: z
    .object({
      id: z.string(),
      displayName: z.string(),
      photoUrl: z.string().nullable(),
      status: z.string(),
      dietaryNotes: z.string().nullable().optional(),
    })
    .optional(),
  previous: z.object({ scannedAt: z.string(), scannedByName: z.string().nullable(), scannedByMe: z.boolean() }).optional(),
  reissued: z.boolean().optional(),
  revokeReason: z.string().nullable().optional(),
  otherEvent: z.string().nullable().optional(),
  capacity: z.number().optional(),
  // PLAN §9.1 (v2)
  servingNo: z.number().optional(),
  servedCount: z.number().optional(),
  points: z.number().optional(),
  tagId: z.string().optional(),
  tagLabel: z.string().nullable().optional(),
  retiredAt: z.string().optional(),
  // PLAN F20: door ACCEPTED only.
  hasBadge: z.boolean().optional(),
  badgeLabel: z.string().nullable().optional(),
  serverTime: z.string(),
});

export type ScanResponse = z.infer<typeof scanResponseSchema>;
