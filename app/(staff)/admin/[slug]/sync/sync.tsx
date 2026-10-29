'use client';

import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Alert } from '@/components/ui/alert';
import { Table, TableHeader, TableRow, TableHead, TableBody, TableCell } from '@/components/ui/table';

import { useCallback, useState } from 'react';
import { formatEventDateTime } from '@/lib/domain/event-time';
import { adminUrl, errorText, useApi, useLoad } from '../api';

interface EventInfo {
  timezone: string;
  sheetId: string | null;
  lastSyncAt: string | null;
}
interface Report {
  dryRun: boolean;
  total: number;
  counts: Record<string, number>;
  changes: Array<{ external_id: string; result: string }>;
}

const SYNC_ERRORS: Record<string, string> = {
  NOT_CONFIGURED: 'No Google Sheet is linked, or Sync now isn’t set up on the server (GOOGLE_SERVICE_ACCOUNT_JSON). Link the Sheet above and share it with the service account.',
  SHEET_READ_FAILED: 'Couldn’t read the Sheet. Check that it’s shared with the service account.',
};

// F10: dry run → review the diff → apply. The same upsert code as the live Sheet sync.
export function Sync({ slug }: { slug: string }) {
  const api = useApi();
  const [event, setEvent] = useState<EventInfo | null>(null);
  const [sheet, setSheet] = useState('');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    const r = await api<EventInfo>(adminUrl(slug, '/event'));
    if (r.ok) setEvent(r.data);
    else setError(errorText(r));
  }, [api, slug]);

  useLoad(load);

  async function link(value: string | null) {
    const r = await api<{ sheetId: string | null }>(adminUrl(slug, '/event'), { method: 'PATCH', body: { sheet: value } });
    if (r.ok) {
      setMessage(value === null ? '✓ Sheet unlinked.' : '✓ Sheet linked.');
      setSheet('');
      setError(null);
    } else setError(r.status === 400 ? 'That doesn’t look like a Google Sheet link or id.' : errorText(r));
    await load();
  }

  async function run(dryRun: boolean) {
    setBusy(true);
    setError(null);
    setMessage(null);
    const r = await api<Report>(adminUrl(slug, '/sync'), { method: 'POST', body: { dryRun } });
    setBusy(false);
    if (!r.ok) {
      setReport(null);
      setError(SYNC_ERRORS[r.data.error ?? ''] ?? errorText(r));
      return;
    }
    setReport(dryRun ? r.data : null);
    if (!dryRun) {
      setMessage(`✓ Applied ${r.data.total} rows: ${r.data.counts.CREATED ?? 0} new applicants. Send them an RSVP from Participants.`);
      await load();
    }
  }

  return (
    <>
      <h1>Sync with Google Sheet</h1>
      {event && (
        <p>
          {event.sheetId ? (
            <>
              Linked Sheet: <code>{event.sheetId}</code>{' '}
              <Button type="button" variant="outline" onClick={() => void link(null)}>
                Unlink
              </Button>
            </>
          ) : (
            'No Sheet linked yet.'
          )}
          <br />
          <span className="tw-admin-muted text-muted-foreground text-[12px] leading-[1.7]">Last sync: {event.lastSyncAt ? formatEventDateTime(event.lastSyncAt, event.timezone) : 'never'}</span>
        </p>
      )}
      <form
        className="tw-admin-toolbar flex flex-wrap [align-items:end] gap-[14px] mb-[20px] p-[18px] [border-width:1px]

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

          [&_select]:text-[14px] [&_select]:font-normal [&_select]:tracking-[normal] [&_select]:normal-case"
        onSubmit={(e) => {
          e.preventDefault();
          void link(sheet);
        }}
      >
        <Label className="tw-admin-field grid min-w-[140px] flex-[1_1_180px] gap-2 text-sm text-muted-foreground" style={{ flex: 1, minWidth: 240 }}>
          Sheet link or id
          <Input className="tw-admin-input w-full" value={sheet} required onChange={(e) => setSheet(e.target.value)} placeholder="https://docs.google.com/spreadsheets/d/…" />
        </Label>
        <Button type="submit" variant="outline">
          Link Sheet
        </Button>
      </form>

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
        <Button type="button" disabled={busy} onClick={() => void run(true)}>
          Sync now (preview)
        </Button>
      </div>
      {error && (
        <Alert className="flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]

          leading-[1.65] [overflow-wrap:anywhere]

          [&&]:[border-color:color-mix(in_srgb,_var(--bad,_#f87171)_40%,_var(--line))]

          [&&]:[background:color-mix(in_srgb,_#f87171_6%,_var(--card))]" asChild><p  role="alert">
          ✕ {error}
        </p></Alert>
      )}
      {message && (
        <Alert className="flex items-start gap-[12px] m-[0px_0px_14px] p-[15px_17px] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-md [background:var(--card)] text-fg text-[13px]

          leading-[1.65] [overflow-wrap:anywhere]

          [&&]:[border-color:color-mix(in_srgb,_var(--ok,_#4ade80)_40%,_var(--line))]

          [&&]:[background:color-mix(in_srgb,_#4ade80_6%,_var(--card))]" asChild role="status"><p  role="status">
          {message}
        </p></Alert>
      )}
      {report && (
        <section aria-labelledby="diff-title">
          <h2 id="diff-title">Preview: {report.total} rows read</h2>
          <div className="tw-admin-tableWrap overflow-x-auto [background:var(--card)] [border-width:1px] [border-style:solid]

          [border-top-color:var(--line)] [border-right-color:var(--line)] [border-bottom-color:var(--line)]

          [border-left-color:var(--line)] rounded-card shadow-panel max-[600.001px]:max-w-full">
            <Table className="tw-admin-table [&_.tw-admin-num]:text-right! [&_.tw-admin-actions]:flex [&_.tw-admin-actions]:items-center [&_.tw-admin-actions]:gap-1 [&_.tw-admin-actions_button]:px-2 [&_.tw-admin-actions_button]:text-xs [&_.tw-admin-badge]:text-xs">
              <TableHeader>
                <TableRow>
                  <TableHead>Result</TableHead>
                  <TableHead className="tw-admin-num text-right! tabular-nums">Rows</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {Object.entries(report.counts).map(([code, n]) => (
                  <TableRow key={code}>
                    <TableCell>{code}</TableCell>
                    <TableCell className="tw-admin-num text-right! tabular-nums">{n}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
          {report.changes.length > 0 && (
            <details>
              <summary>{report.changes.length} rows would change (by Applicant ID)</summary>
              <ul>
                {report.changes.map((c) => (
                  <li key={c.external_id}>
                    <code>{c.external_id}</code>: {c.result}
                  </li>
                ))}
              </ul>
            </details>
          )}
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
            <Button type="button" disabled={busy || report.changes.length === 0} onClick={() => void run(false)}>
              Apply changes
            </Button>
            <Button type="button" variant="outline" onClick={() => setReport(null)}>
              Discard
            </Button>
          </div>
        </section>
      )}
    </>
  );
}
