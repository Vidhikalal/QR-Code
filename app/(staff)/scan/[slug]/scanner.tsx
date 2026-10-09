'use client';

import { createBrowserClient } from '@supabase/ssr';
import { AUTH_COOKIE_DOMAIN, authCookieOptions } from '@/lib/auth/cookie-options';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { parseTagUrl } from '@/lib/badge/tags';
import { parseScannedText } from '@/lib/domain/scanned-text';
import { createNfcReader, isWebNfcSupported, type NfcError, type NfcReader, type NfcTap } from '@/lib/nfc/web-nfc';
import type { ScanRequest } from '@/lib/scan/schema';
import { createDeduper } from '@/lib/scanner/dedupe';
import { playFeedback, unlockAudio } from '@/lib/scanner/feedback';
import { CameraError, createBarcodeScanner, type BarcodeScanner, type CameraFailure } from '@/lib/scanner/qr-scanner';
import { LINK_CODES, viewFor, type LinkCode, type Outcome, type ResultView } from '@/lib/scanner/result-view';
import { submitScan } from '@/lib/scanner/submit';
import { undoVisible } from '@/lib/scanner/undo';
import { keepScreenAwake } from '@/lib/scanner/wake-lock';
import { CheckpointPicker } from './checkpoint-picker';
import { ManualSearch } from './manual-search';
import { ResultScreen, type ResultChoice } from './result-screen';
import styles from './scanner.module.css';
import { CAMERA_KEY, checkpointKey, KIND_LABEL, readPref, writePref, type Checkpoint } from './types';
import { UndoDialog } from './undo-dialog';

type CameraState = 'starting' | 'ready' | CameraFailure;

const subscribeOnline = (cb: () => void) => {
  window.addEventListener('online', cb);
  window.addEventListener('offline', cb);
  return () => {
    window.removeEventListener('online', cb);
    window.removeEventListener('offline', cb);
  };
};

const subscribeNever = () => () => undefined;

const CAMERA_HELP: Record<CameraFailure, string> = {
  denied: 'Camera access is blocked. Allow the camera for this site in your browser settings, then reload. You can still use Manual search.',
  unavailable: 'No camera found or it is in use by another app. You can still use Manual search.',
  other: "The camera couldn't start. Reload the page, or use Manual search.",
};

const NFC_HELP: Record<NfcError, string> = {
  unsupported: 'This browser can’t read NFC. Use Chrome on Android.',
  'permission-denied': 'NFC permission was refused. Allow NFC for this site, then press Start NFC again.',
  'not-readable': 'Couldn’t read that badge. Hold it still and tap again.',
  'write-failed': 'NFC stopped. Press Start NFC again.',
  aborted: 'NFC stopped. Press Start NFC again.',
};

// PLAN F20: after ADMIT, how long "Tap a blank badge" stays up (on top of the 2.5 s ADMIT screen).
const LINK_PROMPT_MS = 32_500;
const LINK_UNDO_MS = 120_000;

interface LinkTarget {
  publicId?: string;
  uid?: string;
}

export function Scanner(props: { slug: string; eventName: string; timezone: string; appOrigin: string }) {
  const { slug, timezone, appOrigin } = props;
  const [checkpoints, setCheckpoints] = useState<Checkpoint[] | null>(null);
  const [checkpointId, setCheckpointId] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [undoOpen, setUndoOpen] = useState(false);
  const [result, setResult] = useState<{ view: ResultView; id: number; shownAt: number } | null>(null);
  const [busy, setBusy] = useState(false);
  const [networkDown, setNetworkDown] = useState(false);
  const [camera, setCamera] = useState<CameraState>('starting');
  const [cameraReadyAt, setCameraReadyAt] = useState<number | null>(null);
  const [checkpointSetAt, setCheckpointSetAt] = useState<number | null>(null);
  const [lastOwn, setLastOwn] = useState<{ at: number; scanId: string } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [notice, setNotice] = useState<string | null>(null);
  // PLAN F20 / §10.1: Web NFC on Android, the door's "Tap a blank badge" step, and its undo.
  const [nfc, setNfc] = useState<'off' | 'starting' | 'on' | NfcError>('off');
  const nfcSupported = useSyncExternalStore(subscribeNever, isWebNfcSupported, () => false);
  const [linkPrompt, setLinkPrompt] = useState<{ participantId: string; name: string; until: number } | null>(null);
  const [pendingReplace, setPendingReplace] = useState<{ participantId: string; name: string; target: LinkTarget } | null>(null);
  const [lastLink, setLastLink] = useState<{ assignmentId: string; at: number } | null>(null);
  const nfcRef = useRef<NfcReader | null>(null);
  const nfcDeduper = useRef(createDeduper());

  const online = useSyncExternalStore(subscribeOnline, () => navigator.onLine, () => true);
  const offline = !online || networkDown;

  const videoRef = useRef<HTMLVideoElement>(null);
  const scannerRef = useRef<BarcodeScanner | null>(null);
  const deduper = useRef(createDeduper());
  const resultSeq = useRef(0);
  const checkpoint = checkpoints?.find((c) => c.id === checkpointId) ?? null;

  const router = useRouter();
  const toLogin = useCallback(() => {
    router.push(`/login?next=${encodeURIComponent(`/scan/${slug}`)}`);
  }, [router, slug]);

  // When scanning actually became possible (camera ready AND a checkpoint chosen); T-SCUI-01 timing.
  const activeAt = cameraReadyAt !== null && checkpointSetAt !== null ? Math.max(cameraReadyAt, checkpointSetAt) : null;

  // PLAN §6.6: tell the server which checkpoint this staff member is working, so a badge page opened on
  // the ME host (no shared localStorage) can offer the right station button. Never blocks scanning.
  // Sent 3 s later (debounced) so it never competes with the first scan's request (PLAN G2 budget).
  const [stationWarning, setStationWarning] = useState(false);
  const stationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const saveStation = useCallback((checkpointId: string) => {
    if (stationTimer.current) clearTimeout(stationTimer.current);
    stationTimer.current = setTimeout(() => {
      void fetch('/api/stations', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ checkpointId }) })
        .then((res) => setStationWarning(!res.ok))
        .catch(() => setStationWarning(true));
    }, 3000);
  }, []);
  useEffect(() => () => {
    if (stationTimer.current) clearTimeout(stationTimer.current);
  }, []);

  // Checkpoints for this event; restore this device's last choice (§10.1).
  useEffect(() => {
    let stale = false;
    void fetch(`/api/events/${encodeURIComponent(slug)}/checkpoints`, { cache: 'no-store' }).then(async (res) => {
      if (stale) return;
      if (res.status === 401) return toLogin();
      const list = res.ok ? ((await res.json()) as { checkpoints: Checkpoint[] }).checkpoints : [];
      if (stale) return;
      setCheckpoints(list);
      const saved = readPref(checkpointKey(slug));
      if (saved && list.some((c) => c.id === saved)) {
        setCheckpointId(saved);
        setCheckpointSetAt(performance.now());
        saveStation(saved);
      } else setPickerOpen(true);
    });
    return () => {
      stale = true;
    };
  }, [slug, toLogin, saveStation]);

  // Keep the session cookie fresh during a long shift (access tokens expire hourly).
  useEffect(() => {
    const supabase = createBrowserClient(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '', process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', authCookieOptions(AUTH_COOKIE_DOMAIN));
    void supabase.auth.getSession();
    return () => void supabase.auth.stopAutoRefresh();
  }, []);

  useEffect(() => {
    if (!networkDown) return;
    const clear = () => setNetworkDown(false);
    window.addEventListener('online', clear);
    return () => window.removeEventListener('online', clear);
  }, [networkDown]);

  const show = useCallback((outcome: Outcome, cp: Checkpoint) => {
    const view = viewFor(outcome, { checkpointKind: cp.kind, checkpointName: cp.name, timezone, now: new Date() });
    const id = ++resultSeq.current;
    setResult({ view, id, shownAt: performance.now() });
    playFeedback(view.sound);
    if (view.dismiss !== 'tap') {
      setTimeout(() => {
        setResult((r) => (r?.id === id ? null : r));
        // Nothing was decoded while this was on screen: restart the window so a code still held in
        // frame stays one scan (T-SCUI-02). Tap-dismissed problems don't, so "Rescan" works at once.
        if (resultSeq.current === id) deduper.current.resumed(Date.now());
      }, view.dismiss.autoMs);
    }
  }, [timezone]);

  const record = useCallback(
    async (part: Pick<ScanRequest, 'method' | 'token' | 'participantId'>) => {
      if (!checkpoint) return;
      setBusy(true);
      setNotice(null);
      // A new physical scan gets a new clientScanId; submitScan's retries reuse it (§10.2).
      const outcome = await submitScan({
        checkpointId: checkpoint.id,
        ...part,
        clientScanId: crypto.randomUUID(),
        clientScannedAt: new Date().toISOString(),
      });
      setBusy(false);
      if (outcome.kind === 'unauthorized') return toLogin();
      if (outcome.kind === 'offline') {
        setNetworkDown(true);
        return show({ kind: 'network' }, checkpoint);
      }
      if (outcome.kind === 'response') {
        if (outcome.data.code === 'ACCEPTED' && outcome.data.scanId && !outcome.data.voided) {
          setLastOwn({ at: Date.now(), scanId: outcome.data.scanId });
          setNow(Date.now());
        }
        // PLAN F20: admitted at the door without a badge → offer "Tap a blank badge" after ADMIT.
        const p = outcome.data.participant;
        if (outcome.data.code === 'ACCEPTED' && outcome.data.hasBadge === false && p) {
          setLinkPrompt({ participantId: p.id, name: p.displayName, until: Date.now() + LINK_PROMPT_MS });
        }
        return show({ kind: 'server', data: outcome.data }, checkpoint);
      }
      show({ kind: outcome.kind }, checkpoint);
    },
    [checkpoint, show, toLogin],
  );

  // PLAN F20: link a badge to the person in the "Tap a blank badge" prompt (assign_tag decides, I-20).
  const link = useCallback(
    async (target: LinkTarget, replace = false) => {
      const person = pendingReplace && replace ? pendingReplace : linkPrompt;
      if (!checkpoint || !person) return;
      setBusy(true);
      const res = await fetch('/api/tags/assign', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ eventSlug: slug, participantId: person.participantId, ...(target.publicId ? { tagPublicId: target.publicId } : {}), ...(target.uid ? { tagUid: target.uid } : {}), replace }),
      }).catch(() => null);
      setBusy(false);
      setPendingReplace(null);
      if (!res) return show({ kind: 'network' }, checkpoint);
      if (res.status === 401) return toLogin();
      const data = (await res.json().catch(() => ({}))) as {
        code?: string;
        assignmentId?: string;
        tagLabel?: string | null;
        holder?: { displayName?: string };
        currentTag?: { label?: string | null };
      };
      const code = (LINK_CODES as readonly string[]).includes(data.code ?? '') ? (data.code as LinkCode) : null;
      if (!code) return show({ kind: 'network' }, checkpoint);
      if ((code === 'ASSIGNED' || code === 'ALREADY_ASSIGNED') && data.assignmentId) {
        setLinkPrompt(null);
        setLastLink({ assignmentId: data.assignmentId, at: Date.now() });
        setNow(Date.now());
      }
      if (code === 'PARTICIPANT_HAS_TAG') setPendingReplace({ participantId: person.participantId, name: person.name, target });
      show(
        { kind: 'link', code, badgeLabel: data.tagLabel ?? null, personName: person.name, holderName: data.holder?.displayName, currentLabel: data.currentTag?.label ?? null },
        checkpoint,
      );
    },
    [checkpoint, linkPrompt, pendingReplace, show, slug, toLogin],
  );

  // A badge was read (printed QR or NFC). Only the door prompt uses it until V5's badge check-ins.
  const onBadge = useCallback(
    (target: LinkTarget) => {
      if (!checkpoint) return;
      if (linkPrompt && linkPrompt.until > Date.now()) return void link(target);
      show({ kind: 'badge_elsewhere' }, checkpoint);
    },
    [checkpoint, linkPrompt, link, show],
  );

  const scanningPaused = !!result || busy || offline || pickerOpen || searchOpen || undoOpen || !checkpoint;
  const onDecode = useRef<(text: string) => void>(() => undefined);
  useEffect(() => {
    onDecode.current = (text: string) => {
      if (scanningPaused || !checkpoint) return;
      if (!deduper.current.shouldHandle(text, Date.now())) return;
      const parsed = parseScannedText(text, appOrigin);
      // MALFORMED never makes a network request (§6.4).
      if (!parsed.ok) return show({ kind: 'malformed' }, checkpoint);
      if (parsed.kind === 'badge') return onBadge({ publicId: parsed.publicId });
      setLinkPrompt(null); // a new pass is the next person
      void record({ method: 'qr', token: parsed.token });
    };
  }, [scanningPaused, checkpoint, appOrigin, record, show, onBadge]);

  // NFC taps (Android): same rules as camera decodes. A tag without our URL may still be one of our
  // badges registered by serial (vendor list), so the serial alone is tried during a link prompt.
  const onTap = useRef<(tap: NfcTap) => void>(() => undefined);
  useEffect(() => {
    onTap.current = (tap: NfcTap) => {
      if (scanningPaused || !checkpoint) return;
      if (!nfcDeduper.current.shouldHandle(tap.uid ?? tap.url ?? '', Date.now())) return;
      const parsed = tap.url ? parseTagUrl(tap.url, appOrigin) : { ok: false as const };
      const promptOpen = linkPrompt !== null && linkPrompt.until > Date.now();
      if (parsed.ok) return onBadge({ publicId: parsed.publicId, ...(tap.uid ? { uid: tap.uid } : {}) });
      if (promptOpen && tap.uid && !tap.url) return void link({ uid: tap.uid });
      show({ kind: 'not_our_badge' }, checkpoint);
    };
  }, [scanningPaused, checkpoint, appOrigin, linkPrompt, onBadge, link, show]);

  async function startNfc() {
    nfcRef.current ??= createNfcReader();
    setNfc('starting');
    await nfcRef.current.start(
      (tap) => onTap.current(tap),
      (e) => setNfc(e),
    );
    setNfc((s) => (s === 'starting' ? 'on' : s));
  }
  useEffect(() => () => nfcRef.current?.stop(), []);

  // The prompt closes on its own after 30 s.
  useEffect(() => {
    if (!linkPrompt) return;
    const t = setTimeout(() => setLinkPrompt((p) => (p === linkPrompt ? null : p)), Math.max(0, linkPrompt.until - Date.now()));
    return () => clearTimeout(t);
  }, [linkPrompt]);

  // Camera: started once; decoding pauses while anything else is on screen (§10.2).
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;
    const scanner = createBarcodeScanner({ deviceId: readPref(CAMERA_KEY) });
    scannerRef.current = scanner;
    let cancelled = false;
    scanner
      .start(video, (text) => onDecode.current(text))
      .then(async () => {
        if (cancelled) return;
        setCamera('ready');
        setCameraReadyAt(performance.now());
        const [track] = (video.srcObject instanceof MediaStream ? video.srcObject.getVideoTracks() : []) ?? [];
        const deviceId = track?.getSettings().deviceId;
        if (deviceId) writePref(CAMERA_KEY, deviceId);
      })
      .catch((err: unknown) => {
        if (!cancelled) setCamera(err instanceof CameraError ? err.reason : 'other');
      });
    return () => {
      cancelled = true;
      void scanner.stop();
    };
  }, []);

  useEffect(() => {
    scannerRef.current?.setPaused(scanningPaused);
  }, [scanningPaused]);

  useEffect(() => (camera === 'ready' ? keepScreenAwake() : undefined), [camera]);

  // Tick while an undo is possible so the button hides at 120 s (§10.3).
  useEffect(() => {
    if (!lastOwn && !lastLink) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lastOwn, lastLink]);

  function dismiss() {
    const action = result?.view.action;
    setResult(null);
    if (action === 'pick-checkpoint') setPickerOpen(true);
    if (action === 'manual-search') setSearchOpen(true);
  }

  function chooseCheckpoint(id: string) {
    writePref(checkpointKey(slug), id);
    setCheckpointId(id);
    setCheckpointSetAt(performance.now());
    setPickerOpen(false);
    setLastOwn(null);
    saveStation(id);
  }

  async function undo(reason: string) {
    if (!lastOwn) return;
    setUndoOpen(false);
    const res = await fetch(`/api/scans/${lastOwn.scanId}/void`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ reason }),
    }).catch(() => null);
    if (!res) return setNotice('✕ Undo failed: no connection.');
    if (res.status === 401) return toLogin();
    const body = (await res.json().catch(() => ({}))) as { code?: string };
    if (body.code === 'VOIDED' || body.code === 'ALREADY_VOIDED') {
      setLastOwn(null);
      setNotice('✓ Last scan undone.');
    } else if (body.code === 'FORBIDDEN') {
      setLastOwn(null);
      setNotice('✕ Too late to undo. Ask an organizer.');
    } else {
      setNotice('✕ Undo failed. Try again.');
    }
  }

  async function undoLink() {
    if (!lastLink) return;
    const res = await fetch('/api/tags/unassign', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ assignmentId: lastLink.assignmentId }),
    }).catch(() => null);
    if (res?.status === 401) return toLogin();
    const body = (await res?.json().catch(() => ({}))) as { code?: string } | undefined;
    setLastLink(null);
    setNotice(body?.code === 'UNASSIGNED' || body?.code === 'ALREADY_ENDED' ? '✓ Badge link undone. The badge can be used again.' : '✕ Too late to undo the link. Ask an organizer.');
  }

  const showUndo = undoVisible(lastOwn, now) && !offline;
  const showUndoLink = lastLink !== null && now - lastLink.at <= LINK_UNDO_MS && !offline;
  const replaceChoices: ResultChoice[] | undefined =
    result?.view.action === 'replace-badge' && pendingReplace
      ? [
          { label: 'Replace it', danger: true, onClick: () => { setResult(null); void link(pendingReplace.target, true); } },
          { label: 'Cancel', onClick: () => { setResult(null); setPendingReplace(null); } },
        ]
      : undefined;

  return (
    <main
      className={styles.root}
      onPointerDown={unlockAudio}
      data-camera={camera}
      data-scanning={scanningPaused ? 'paused' : 'on'}
      data-active-at={activeAt ?? undefined}
    >
      <header className={styles.banner} data-kind={checkpoint?.kind ?? 'none'} data-testid="checkpoint-banner">
        <span className={styles.bannerText}>
          <span className={styles.bannerKind}>
            {checkpoint ? `${KIND_LABEL[checkpoint.kind]}${checkpoint.isOpen ? '' : ' · closed'}` : props.eventName}
          </span>
          <span className={styles.bannerName}>{checkpoint?.name ?? 'No checkpoint selected'}</span>
        </span>
        {stationWarning && (
          <span className={styles.bannerKind} role="status">
            ! Station not saved: badge pages won’t show this checkpoint
          </span>
        )}
        <button type="button" className={styles.bannerButton} onClick={() => setPickerOpen(true)} disabled={!checkpoints}>
          Change
        </button>
      </header>

      {offline && (
        <div className={styles.offline} role="alert">
          ⚠ OFFLINE: use paper list
        </div>
      )}

      <div className={styles.viewport}>
        <video ref={videoRef} className={styles.video} playsInline muted aria-label="Camera view" />
        {camera !== 'starting' && camera !== 'ready' && (
          <div className={styles.viewportMessage} role="alert">
            <p>📷 {CAMERA_HELP[camera]}</p>
          </div>
        )}
        <div className={styles.status} aria-live="polite">
          {busy ? 'Checking…' : camera === 'starting' ? 'Starting camera…' : camera === 'ready' && checkpoint ? 'Ready to scan' : ''}
        </div>
      </div>

      <div className={styles.actions}>
        <button type="button" onClick={() => setSearchOpen(true)} disabled={offline || !checkpoint}>
          Manual search
        </button>
        {showUndo && (
          <button type="button" className={styles.secondary} onClick={() => setUndoOpen(true)}>
            Undo last
          </button>
        )}
        {showUndoLink && (
          <button type="button" className={styles.secondary} onClick={() => void undoLink()}>
            Undo badge link
          </button>
        )}
        {nfcSupported && nfc !== 'on' && (
          <button type="button" className={styles.secondary} onClick={() => void startNfc()} disabled={nfc === 'starting'}>
            Start NFC
          </button>
        )}
      </div>
      <p className={styles.nfcState} aria-live="polite" data-testid="nfc-state">
        {!nfcSupported
          ? 'iPhone: tap badges with this phone’s NFC (opens the badge page).'
          : nfc === 'on'
            ? '📶 NFC ready: tap a badge'
            : nfc === 'off' || nfc === 'starting'
              ? ''
              : `⚠ ${NFC_HELP[nfc]}`}
      </p>
      {notice && (
        <p className={styles.notice} role="status">
          {notice}
        </p>
      )}

      {pickerOpen && checkpoints && (
        <CheckpointPicker checkpoints={checkpoints} currentId={checkpointId} onChoose={chooseCheckpoint} onCancel={() => setPickerOpen(false)} />
      )}
      {searchOpen && checkpoint && (
        <ManualSearch
          slug={slug}
          checkpointId={checkpoint.id}
          disabled={offline || busy}
          onUnauthorized={toLogin}
          onClose={() => setSearchOpen(false)}
          onRecord={(participantId) => {
            setSearchOpen(false);
            void record({ method: 'manual', participantId });
          }}
        />
      )}
      {undoOpen && <UndoDialog onSubmit={(r) => void undo(r)} onCancel={() => setUndoOpen(false)} />}
      {linkPrompt && !result && (
        <section className={styles.prompt} aria-label="Tap a blank badge" data-testid="badge-prompt">
          <p className={styles.promptTitle}>Tap a blank badge</p>
          <p className={styles.promptDetail}>
            For {linkPrompt.name}. {nfc === 'on' ? 'Hold it to the back of this phone,' : 'Show its printed QR to the camera,'} or skip.
          </p>
          <button type="button" className={styles.secondary} onClick={() => setLinkPrompt(null)}>
            Skip
          </button>
        </section>
      )}
      {result && <ResultScreen view={result.view} shownAt={result.shownAt} onDismiss={dismiss} choices={replaceChoices} />}
    </main>
  );
}
