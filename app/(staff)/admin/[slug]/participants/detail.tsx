'use client';

import { Button } from '@/components/ui/button';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';

import { useCallback, useState } from 'react';
import { adminUrl, errorText, useApi, useLoad } from '../api';
import { VoidDialog } from '../dialog';
import { fullName } from './name';

interface Detail {
  participant: {
    id: string;
    firstName: string;
    lastName: string;
    email: string;
    status: string;
    source: string;
    applicantId: string | null;
    dietaryNotes: string | null;
    linkedinUrl: string | null;
    emergency: { name: string; phone: string; relation: string | null } | null;
    overnight: string | null;
    teamStatus: string | null;
    allergies: string | null;
    allergySeverity: string | null;
    accessibility: string | null;
  };
  scans: Array<{ id: string; checkpointName: string; kind: string; scannedAt: string; method: string; scannedByName: string | null; voided: boolean; voidReason: string | null }>;
}

// v0.9 profile setup answers, as the hacker chose them (F14).
const OVERNIGHT: Record<string, string> = { yes: 'Yes', no: 'No', unsure: 'Not sure yet' };
const TEAM_STATUS: Record<string, string> = { team: 'Has a team', looking: 'Looking for a team', solo: 'Going solo' };

const VOID_TEXT: Record<string, string> = {
  VOIDED: '✓ Scan voided.',
  ALREADY_VOIDED: '! That scan was already voided.',
  NOT_FOUND: '✕ Scan not found.',
  FORBIDDEN: '✕ You can’t void that scan.',
};

// Scan history + void (F11). Organizers may void any scan at any time; void_scan() enforces it.
export function ParticipantDetail(props: { slug: string; id: string; onClose: () => void; onChanged: () => Promise<void> }) {
  const api = useApi();
  const [detail, setDetail] = useState<Detail | null>(null);
  const [timezone, setTimezone] = useState<string>('UTC');
  const [voiding, setVoiding] = useState<Detail['scans'][number] | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [d, e] = await Promise.all([
      api<Detail>(adminUrl(props.slug, `/participants/${props.id}`)),
      api<{ timezone: string }>(adminUrl(props.slug, '/event')),
    ]);
    if (d.ok) setDetail(d.data);
    else setMessage(`✕ ${errorText(d)}`);
    if (e.ok) setTimezone(e.data.timezone);
  }, [api, props.slug, props.id]);

  useLoad(load);

  async function voidScan(scanId: string, reason: string) {
    setVoiding(null);
    const r = await api<{ code: string }>(`/api/scans/${scanId}/void`, { method: 'POST', body: { reason } });
    setMessage(r.ok ? (VOID_TEXT[r.data.code] ?? r.data.code) : `✕ ${errorText(r)}`);
    await load();
    await props.onChanged();
  }

  if (!detail) return <section className="tw-admin-drawer

          [background:linear-gradient(_135deg,_color-mix(in_srgb,_var(--accent)_4%,_transparent),_transparent_45%_),_var(--card)]

          [border-width:1px] [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-card p-[24px] m-[12px_0px]

          shadow-panel max-[600.001px]:p-[16px] [&_h2]:mt-0 [&_h3]:mt-[16px] [&_>_.tw-admin-toolbar]:items-center

          [&_>_.tw-admin-toolbar]:gap-[12px] [&_>_.tw-admin-toolbar]:mb-[22px] [&_>_.tw-admin-toolbar]:pb-[16px]

          [&_>_.tw-admin-toolbar]:[border-bottom-width:1px] [&_>_.tw-admin-toolbar]:[border-bottom-style:solid]

          [&_>_.tw-admin-toolbar]:[border-bottom-color:var(--line)]

          max-[600.001px]:[&_>_.tw-admin-toolbar]:items-start [&_>_.tw-admin-toolbar_h2]:m-0

          [&_>_.tw-admin-toolbar_h2]:min-w-0 [&_>_.tw-admin-toolbar_h2]:[overflow-wrap:anywhere]

          [&&_>_.tw-admin-toolbar_h2]:text-[clamp(20px,_3vw,_26px)]
          [&_>_.tw-admin-toolbar_h2]:tracking-[-0.035em]
 [&_.tw-admin-tableWrap]:max-w-full
          [&_.tw-admin-tableWrap]:overflow-x-auto
 [&_.tw-admin-table]:min-w-[580px]">{message ?? 'Loading…'}</section>;
  const p = detail.participant;
  const name = fullName(p);
  const time = (iso: string) =>
    new Intl.DateTimeFormat('en-US', { timeZone: timezone, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));

  return (
    <section className="tw-admin-drawer

          [background:linear-gradient(_135deg,_color-mix(in_srgb,_var(--accent)_4%,_transparent),_transparent_45%_),_var(--card)]

          [border-width:1px] [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-card p-[24px] m-[12px_0px]

          shadow-panel max-[600.001px]:p-[16px] [&_h2]:mt-0 [&_h3]:mt-[16px] [&_>_.tw-admin-toolbar]:items-center

          [&_>_.tw-admin-toolbar]:gap-[12px] [&_>_.tw-admin-toolbar]:mb-[22px] [&_>_.tw-admin-toolbar]:pb-[16px]

          [&_>_.tw-admin-toolbar]:[border-bottom-width:1px] [&_>_.tw-admin-toolbar]:[border-bottom-style:solid]

          [&_>_.tw-admin-toolbar]:[border-bottom-color:var(--line)]

          max-[600.001px]:[&_>_.tw-admin-toolbar]:items-start [&_>_.tw-admin-toolbar_h2]:m-0

          [&_>_.tw-admin-toolbar_h2]:min-w-0 [&_>_.tw-admin-toolbar_h2]:[overflow-wrap:anywhere]

          [&&_>_.tw-admin-toolbar_h2]:text-[clamp(20px,_3vw,_26px)]
          [&_>_.tw-admin-toolbar_h2]:tracking-[-0.035em]
 [&_.tw-admin-tableWrap]:max-w-full
          [&_.tw-admin-tableWrap]:overflow-x-auto
 [&_.tw-admin-table]:min-w-[580px]" aria-labelledby="detail-title">
      <div className="tw-admin-toolbar flex flex-wrap [align-items:end] gap-[14px] mb-[20px] p-[18px] [border-width:1px]

          [border-style:solid] [border-top-color:var(--line)] [border-right-color:var(--line)]

          [border-bottom-color:var(--line)] [border-left-color:var(--line)] rounded-card

          [background:linear-gradient(_135deg,_color-mix(in_srgb,_var(--accent)_4%,_transparent),_transparent_65%_),_var(--card)]

          shadow-panel max-[700.001px]:items-stretch max-[700.001px]:gap-[12px] max-[700.001px]:p-[14px]

          [&_.tw-admin-input]:w-full [&_.tw-admin-input]:min-h-[44px] [&_.tw-admin-input]:text-[14px]

          [&_.tw-admin-input]:tracking-[normal] [&_.tw-admin-input]:normal-case

          [&_.tw-admin-input]:[font-family:inherit] [&_.tw-admin-input]:font-normal

          [&_.tw-admin-check]:min-h-[44px] [&_.tw-admin-check]:inline-flex [&_.tw-admin-check]:items-center

          [&_.tw-admin-check]:gap-[9px] [&_.tw-admin-check]:p-[0px_4px] [&_.tw-admin-check]:text-fg

          [&_.tw-admin-check]:text-[13px] [&_.tw-admin-check]:tracking-[normal] [&_.tw-admin-check]:normal-case

          max-[700.001px]:[&_.tw-admin-check]:[flex:1_1_100%] [&_>_button]:min-h-[44px] [&_>_button]:p-[0px_16px]

          [&_>_button]:whitespace-nowrap max-[700.001px]:[&_>_button]:[flex:1_1_auto]

          [&_.tw-admin-field]:[font-family:inherit] [&_.tw-admin-field]:text-[12px]

          [&_.tw-admin-field]:font-semibold [&_.tw-admin-field]:tracking-[0.02em] [&_.tw-admin-field]:normal-case

          max-[700.001px]:[&_.tw-admin-field]:[flex:1_1_100%] [&_select]:[font-family:inherit]

          [&_select]:text-[14px] [&_select]:font-normal [&_select]:tracking-[normal] [&_select]:normal-case">
        <h2 id="detail-title" style={{ flex: 1 }}>
          {name}
        </h2>
        <Button type="button" variant="outline" onClick={props.onClose}>
          Close
        </Button>
      </div>
      <div>
        <dl className="grid [grid-template-columns:minmax(110px,_150px)_minmax(0px,_1fr)] gap-[8px_16px] min-w-0 m-0

          max-[600.001px]:[grid-template-columns:1fr] max-[600.001px]:gap-[4px] [&_dt]:text-muted-foreground

          [&_dt]:text-[11px] [&_dt]:font-semibold [&_dt]:tracking-[0.04em] [&_dt]:uppercase [&_dd]:min-w-0

          [&_dd]:m-0 [&_dd]:[overflow-wrap:anywhere] [&_dd]:text-[13px] [&_dd]:leading-[1.55]

          max-[600.001px]:[&_dd]:m-[0px_0px_12px] [&_a]:text-accent [&_a]:no-underline [&_a:hover]:underline">
          <dt className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Email</dt>
          <dd>{p.email}</dd>
          <dt className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Status</dt>
          <dd>
            {p.status} · {p.source}
          </dd>
          {p.dietaryNotes && (
            <>
              <dt className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Dietary notes</dt>
              <dd>{p.dietaryNotes}</dd>
            </>
          )}
          {p.emergency && (
            <>
              <dt className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Emergency contact</dt>
              <dd>
                {p.emergency.name}
                {p.emergency.relation && ` (${p.emergency.relation})`} · <a href={`tel:${p.emergency.phone.replace(/[^0-9+]/g, '')}`}>{p.emergency.phone}</a>
              </dd>
            </>
          )}
          {p.allergies && (
            <>
              <dt className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Allergies</dt>
              <dd>
                {p.allergySeverity === 'severe' ? <strong>Severe: {p.allergies}</strong> : `${p.allergies} (${p.allergySeverity ?? ''})`}
              </dd>
            </>
          )}
          {p.accessibility && (
            <>
              <dt className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Accessibility</dt>
              <dd>{p.accessibility}</dd>
            </>
          )}
          <dt className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Overnight</dt>
          <dd>{p.overnight ? OVERNIGHT[p.overnight] : 'Not answered'}</dd>
          <dt className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Team</dt>
          <dd>{p.teamStatus ? TEAM_STATUS[p.teamStatus] : 'Not answered'}</dd>
        </dl>
      </div>
      {message && (
        <p className={`flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]
                [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]
                [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]
                leading-[1.65] [overflow-wrap:anywhere]` + ' ' + (message.startsWith('✓') ? `[&&]:[border-color:color-mix(in_srgb,_var(--ok,_#4ade80)_40%,_var(--line))]
                [&&]:[background:color-mix(in_srgb,_#4ade80_6%,_var(--card))]` : `[&&]:[border-color:color-mix(in_srgb,_var(--warn,_#fbbf24)_40%,_var(--line))]
                [&&]:[background:color-mix(in_srgb,_#fbbf24_6%,_var(--card))]`)} data-tone={message.startsWith('✓') ? 'ok' : message.startsWith('✕') ? 'bad' : 'warn'} aria-live="polite">
          {message}
        </p>
      )}
      <h3 className="flex items-center gap-[10px] m-[28px_0px_14px] pt-[18px] [border-top-width:1px]
          [border-top-style:solid]
 [border-top-color:var(--line)] text-[15px] [font-weight:650]
          tracking-[-0.02em]">Scan history</h3>
      {detail.scans.length === 0 ? (
        <p className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">No scans.</p>
      ) : (
        <div className="tw-admin-tableWrap overflow-x-auto [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-card shadow-panel max-[600.001px]:max-w-full">
          <Table className="tw-admin-table [&_.tw-admin-num]:text-right! [&_.tw-admin-actions]:flex [&_.tw-admin-actions]:items-center [&_.tw-admin-actions]:gap-1 [&_.tw-admin-actions_button]:px-2 [&_.tw-admin-actions_button]:text-xs [&_.tw-admin-badge]:text-xs">
            <TableHeader>
              <TableRow>
                <TableHead>Checkpoint</TableHead>
                <TableHead>When</TableHead>
                <TableHead>By</TableHead>
                <TableHead>State</TableHead>
                <TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {detail.scans.map((s) => (
                <TableRow key={s.id}>
                  <TableCell>{s.checkpointName}</TableCell>
                  <TableCell>{time(s.scannedAt)}</TableCell>
                  <TableCell>
                    {s.scannedByName ?? '—'} ({s.method})
                  </TableCell>
                  <TableCell>{s.voided ? `✕ Voided: ${s.voidReason ?? ''}` : '✓ Live'}</TableCell>
                  <TableCell>
                    {!s.voided && (
                      <Button type="button" variant="outline" aria-label={`Void ${s.checkpointName} scan`} onClick={() => setVoiding(s)}>
                        Void
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
      {voiding && <VoidDialog what={`${voiding.checkpointName} scan`} onSubmit={(reason) => void voidScan(voiding.id, reason)} onCancel={() => setVoiding(null)} />}
    </section>
  );
}
