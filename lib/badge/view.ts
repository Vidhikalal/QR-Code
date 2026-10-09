import type { StaffRole } from '@/lib/auth/staff';
import { toPublicProfile, type ProfileFields, type PublicProfile } from '@/lib/profile/public';
import type { BadgeRole } from '@/lib/profile/schema';

// PLAN §8.2: everything about "who sees what" on /t/<publicId>. Pure; the T-BADGE matrix tests it.
// Public parts only ever come from toPublicProfile() (I-19). Only staff views carry a `staff` field.

export type Viewer =
  | { kind: 'anonymous' }
  | { kind: 'participant'; participantId: string; eventId: string }
  | { kind: 'staff'; userId: string; eventId: string; role: StaffRole; participantId?: string };

export interface Involvement {
  doorAt: string | null;
  meals: Array<{ checkpointId: string; name: string; servings: Array<{ no: number; at: string }> }>;
  activities: Array<{ checkpointId: string; name: string; kind: string; at: string; points: number }>;
  points: number;
}
export interface StationCheckpoint {
  checkpointId: string;
  name: string;
  kind: 'door' | 'meal' | 'session' | 'custom';
}

export interface StaffExtras {
  holder: { fullName: string; badgeRole: string; status: string; photoUrl: string | null } | null;
  /** V5b: this staff member's station (staff_stations), the event's open checkpoints, the holder's activity. */
  station?: StationCheckpoint | null;
  checkpoints?: StationCheckpoint[];
  involvement?: Involvement | null;
  /** The latest person this staff member admitted at the door in the last 2 minutes, with no badge. */
  suggestion: { participantId: string; name: string; admittedAt: string } | null;
}

export interface BadgeInput {
  event: { id: string; slug: string; name: string; endsAt: string; retentionDays: number; timezone?: string };
  tag: { id: string; label: string | null; retiredAt: string | null; publicId?: string } | null;
  assignment: { id: string; participantId: string; assignedAt: string; assignedBy: string } | null;
  holder: { participantId: string; firstName: string; lastName: string; badgeRole: BadgeRole; fields: ProfileFields | null } | null;
  /** For retired badges: who wore it last, and the label of the badge they wear now (if any). */
  lastHolder: { participantId: string; name: string; currentLabel: string | null } | null;
  viewer: Viewer;
  extraRoles: boolean;
  now: Date;
  staffExtras?: StaffExtras;
}

type StaffPanel = {
  role: StaffRole;
  eventSlug: string;
  label: string | null;
  holder: StaffExtras['holder'];
  assignment: { id: string; canUnlink: boolean } | null;
  hiddenBy: 'owner' | 'staff' | null;
  participantId: string | null;
  /** For the station check-in POST (PLAN F21); the badge id identifies, the staff session authorizes. */
  publicId: string;
  station: StationCheckpoint | null;
  checkpoints: StationCheckpoint[];
  involvement: Involvement | null;
  timezone: string;
};

export type BadgeView =
  | { kind: 'not_found' }
  | { kind: 'used'; eventName: string; profileDeletedOn?: string }
  | { kind: 'retired'; eventName: string; replacementLabel?: string; staff?: { retiredAt: string; current: { label: string; holderName: string } | null } }
  | { kind: 'unlinked'; eventName: string; label: string | null; staff?: { role: StaffRole; eventSlug: string; tagLabel: string | null; suggestion: { participantId: string; name: string; secondsAgo: number } | null } }
  | {
      kind: 'linked';
      eventName: string;
      audience: 'anonymous' | 'participant' | 'owner' | 'staff';
      profile: PublicProfile;
      ownerOnlyNote: boolean;
      staff?: StaffPanel;
    };

const UNLINK_WINDOW_MS = 120_000;

export function badgeView(input: BadgeInput): BadgeView {
  const { event, tag, viewer, now } = input;
  if (!tag) return { kind: 'not_found' };

  // Staff of ANOTHER event are just visitors here (T-BADGE-03); same for participants.
  const staff = viewer.kind === 'staff' && viewer.eventId === event.id ? viewer : null;
  const myParticipantId =
    viewer.kind === 'participant' && viewer.eventId === event.id ? viewer.participantId : staff?.participantId ?? null;

  const deleteAt = new Date(new Date(event.endsAt).getTime() + event.retentionDays * 86_400_000);
  if (now > deleteAt) {
    return staff ? { kind: 'used', eventName: event.name, profileDeletedOn: deleteAt.toISOString() } : { kind: 'used', eventName: event.name };
  }

  if (tag.retiredAt) {
    const last = input.lastHolder;
    const view: Extract<BadgeView, { kind: 'retired' }> = { kind: 'retired', eventName: event.name };
    if (last && myParticipantId === last.participantId && last.currentLabel) view.replacementLabel = last.currentLabel;
    if (staff) view.staff = { retiredAt: tag.retiredAt, current: last?.currentLabel ? { label: last.currentLabel, holderName: last.name } : null };
    return view;
  }

  const { assignment, holder } = input;
  if (!assignment || !holder) {
    const view: Extract<BadgeView, { kind: 'unlinked' }> = { kind: 'unlinked', eventName: event.name, label: tag.label };
    if (staff) {
      const s = input.staffExtras?.suggestion ?? null;
      view.staff = {
        role: staff.role,
        eventSlug: event.slug,
        tagLabel: tag.label,
        suggestion: s && { participantId: s.participantId, name: s.name, secondsAgo: Math.max(0, Math.round((now.getTime() - new Date(s.admittedAt).getTime()) / 1000)) },
      };
    }
    return view;
  }

  const isOwner = myParticipantId === holder.participantId;
  const hiddenBy = holder.fields?.hiddenByStaffAt ? 'staff' : holder.fields?.visibility === 'hidden' ? 'owner' : null;
  const participant = { firstName: holder.firstName, lastName: holder.lastName, badgeRole: holder.badgeRole };
  // The owner always sees their own full profile, with a note when others can't (PLAN §8.2).
  const profile = toPublicProfile({
    participant,
    profile: isOwner && holder.fields ? { ...holder.fields, visibility: 'public', hiddenByStaffAt: null } : holder.fields,
    eventName: event.name,
    extraRoles: input.extraRoles,
  });
  const audience = isOwner ? 'owner' : staff ? 'staff' : viewer.kind === 'participant' && viewer.eventId === event.id ? 'participant' : 'anonymous';
  const view: Extract<BadgeView, { kind: 'linked' }> = { kind: 'linked', eventName: event.name, audience, profile, ownerOnlyNote: isOwner && hiddenBy !== null };
  if (staff) {
    const own = assignment.assignedBy === staff.userId && now.getTime() - new Date(assignment.assignedAt).getTime() <= UNLINK_WINDOW_MS;
    view.staff = {
      role: staff.role,
      eventSlug: event.slug,
      label: tag.label,
      holder: input.staffExtras?.holder ?? null,
      assignment: { id: assignment.id, canUnlink: staff.role === 'organizer' || own },
      hiddenBy,
      participantId: holder.participantId,
      publicId: tag.publicId ?? '',
      station: input.staffExtras?.station ?? null,
      checkpoints: input.staffExtras?.checkpoints ?? [],
      involvement: input.staffExtras?.involvement ?? null,
      timezone: event.timezone ?? 'UTC',
    };
  }
  return view;
}
