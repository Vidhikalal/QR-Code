import { tagsRoute } from '@/lib/tags/server';

// PLAN F19 A: record the chip serial read back after writing.
export const POST = tagsRoute('confirm');
