// Legacy uploads are retained only for retention and participant-deletion cleanup.
export const PHOTO_BUCKET = 'photos';

export function photoPath(eventId: string, participantId: string): string {
  return `${eventId}/${participantId}.jpg`;
}
