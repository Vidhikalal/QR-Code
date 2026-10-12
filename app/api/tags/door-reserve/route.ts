import { tagsRoute } from '@/lib/tags/server';

// Door: reserve an id for a blank badge while "Tap a blank badge" is up. Staff, both hosts (I-23).
export const POST = tagsRoute('doorReserve');
