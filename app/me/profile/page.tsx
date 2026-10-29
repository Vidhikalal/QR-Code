import { Entrance } from '@/components/motion';
import type { Metadata } from 'next';
import Link from 'next/link';
import { loadMyEvent, menuMetadata } from '../load';
import { ProfileForms } from './profile-forms';

export const metadata: Metadata = menuMetadata('Hacker profile');

// SPEC F14 step 3: profile setup (emergency contact, overnight, team status, allergies, accessibility) and the
// networking links, each card saved on its own (./actions.ts). Only the signed-in hacker's own row is loaded.
export default async function HackerProfilePage() {
  const { me: m } = await loadMyEvent('/me/profile');

  return (
    <Entrance><main className="max-w-[480px] lg:pointer-fine:max-w-[760px]  m-[0px_auto] p-[24px_16px_56px] flex flex-col gap-[16px] [:where(&)_>_*]:mt-0

          [:where(&)_>_*]:mb-0">
      <div className="flex items-center justify-between gap-[16px] min-h-[44px] pb-[4px] mb-[8px] [border-bottom-width:1px]

          [border-bottom-style:solid] [border-bottom-color:var(--line)]">
        <Link className="inline-flex items-center min-h-[44px] text-fg font-semibold no-underline [&:hover]:text-accent" href="/me">
          ← Menu
        </Link>
        <span className="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-muted-foreground text-[12px] tracking-[0.08em]

          uppercase">{m.event.name}</span>
      </div>
      <h1>{m.profileDone ? 'Hacker profile' : 'Finish setting up your profile'}</h1>
      {!m.profileDone && <p className="m-0 text-muted-foreground text-[14px]">A few things we need before {m.event.name}. They stay with the organizers; volunteers serving food see your allergy.</p>}
      <ProfileForms
        values={{
          participantId: m.participantId,
          name: `${m.firstName} ${m.lastName}`.trim(),
          badge: m.badge,
          emergencyName: m.emergency?.name ?? '',
          emergencyPhone: m.emergency?.phone ?? '',
          emergencyRelation: m.emergency?.relation ?? '',
          overnight: m.overnight ?? '',
          teamStatus: m.teamStatus ?? '',
          allergies: m.allergies ?? '',
          allergySeverity: m.allergySeverity ?? '',
          accessibility: m.accessibility ?? '',
          linkedin: m.linkedinUrl ?? '',
          discord: m.discordUsername ?? '',
          website: m.websiteUrl ?? '',
          profilePublic: m.profilePublic,
        }}
      />
    </main></Entrance>
  );
}
