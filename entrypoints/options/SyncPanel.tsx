// Options sub-panel: chunked encrypted `.raf` export/import + conflict merge preview + local WebRTC transfer.
import { useMemo, useRef, useState } from 'react';
import { useT } from '../../src/i18n';
import type { Profile } from '../../src/schema';
import { deleteFile, listFiles, putFile } from '../../src/storage';
import {
  RAF_MIN_PASSWORD_LENGTH,
  RafError,
  SyncMergeError,
  applySyncMerge,
  buildRafArchive,
  createReceiverSession,
  createSenderSession,
  decodeQrImageFile,
  deleteOrphanFiles,
  inspectSyncArchive,
  localFingerprintText,
  parseKnownHashes,
  planSyncMerge,
  renderQrSvg,
  unlockSyncArchive,
  type SyncAttachmentInput,
  type SyncMode,
  type SyncStorageAdapter,
  type UnlockedSyncPayload,
} from '../../src/sync';
import { loadApplications, mergeTrackerRecords, saveApplications } from '../../src/tracker';
import { Badge, Button, Divider, Field, Input, Notice, Segmented, Textarea } from './ui/controls';
import { useToast } from './ui/Toast';

interface SyncPanelProps {
  profile: Profile | null;
  onApplyProfile: (profile: Profile) => Promise<void>;
}

async function readAllSyncFiles(): Promise<SyncAttachmentInput[]> {
  const files = await listFiles();
  const out: SyncAttachmentInput[] = [];
  for (const f of files) {
    const bytes = new Uint8Array(await f.blob.arrayBuffer());
    out.push({ id: f.id, name: f.name, type: f.type, bytes });
  }
  return out;
}

const extensionStorageAdapter = (): SyncStorageAdapter => ({
  async listExistingFiles() {
    const files = await listFiles();
    return Promise.all(
      files.map(async (f) => ({ id: f.id, bytes: new Uint8Array(await f.blob.arrayBuffer()) })),
    );
  },
  async saveFile(input) {
    const copy = new Uint8Array(input.bytes.byteLength);
    copy.set(input.bytes);
    return putFile({ name: input.name, type: input.type, blob: new Blob([copy.buffer], { type: input.type }) });
  },
  deleteFile,
});

type WebRtcRole = 'idle' | 'sender' | 'receiver';

export function SyncPanel({ profile, onApplyProfile }: SyncPanelProps) {
  const t = useT();
  const toast = useToast();

  const [mode, setMode] = useState<SyncMode>('full');
  const [deltaMode, setDeltaMode] = useState(false);
  const [knownHashesInput, setKnownHashesInput] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Pending encrypted bytes waiting for passphrase unlock
  const [lockedBytes, setLockedBytes] = useState<Uint8Array | null>(null);
  const [unlockPass, setUnlockPass] = useState('');
  const [unlockError, setUnlockError] = useState<string | null>(null);

  // Unlocked payload + selected resume IDs for conflict merge preview
  const [unlocked, setUnlocked] = useState<UnlockedSyncPayload | null>(null);
  const [adoptIds, setAdoptIds] = useState<ReadonlySet<string>>(new Set());
  const [trackerExistingCount, setTrackerExistingCount] = useState(0);

  // Local WebRTC state
  const [rtcRole, setRtcRole] = useState<WebRtcRole>('idle');
  const [offerToken, setOfferToken] = useState('');
  const [answerToken, setAnswerToken] = useState('');
  const [remoteSignalInput, setRemoteSignalInput] = useState('');
  const [mdnsWarn, setMdnsWarn] = useState(false);
  const [progress, setProgress] = useState<{ done: number; total: number } | null>(null);
  const senderRef = useRef<Awaited<ReturnType<typeof createSenderSession>> | null>(null);
  const receiverRef = useRef<Awaited<ReturnType<typeof createReceiverSession>> | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const qrImgInputRef = useRef<HTMLInputElement>(null);

  const mergePlan = useMemo(() => {
    if (!unlocked || !profile) return null;
    return planSyncMerge(profile, unlocked, []);
  }, [unlocked, profile]);

  const offerQrDataUrl = useMemo(() => {
    const token = rtcRole === 'sender' ? offerToken : rtcRole === 'receiver' ? answerToken : '';
    if (!token) return null;
    try {
      const svg = renderQrSvg(token, t('options.sync.offerQr'));
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    } catch {
      return null;
    }
  }, [rtcRole, offerToken, answerToken, t]);

  const buildEncryptedBytes = async (): Promise<Uint8Array | null> => {
    if (!profile) return null;
    if ([...passphrase.normalize('NFC')].length < RAF_MIN_PASSWORD_LENGTH) {
      setError(t('options.sync.passwordShort'));
      return null;
    }
    // Only the receiver's own fingerprints belong here; anything that is not a SHA-256 is refused, not guessed at.
    const known = deltaMode ? parseKnownHashes(knownHashesInput) : null;
    if (known && known.invalid.length > 0) {
      setError(t('options.sync.badKnownHashes', { list: known.invalid.slice(0, 3).join(', ') }));
      return null;
    }
    setError(null);
    const tracker = await loadApplications().catch(() => []);
    const attachments = mode === 'full' ? await readAllSyncFiles() : [];
    return buildRafArchive({
      profile,
      tracker,
      attachments,
      mode,
      password: passphrase,
      ...(known ? { version: 3 as const, knownAttachmentHashes: known.hashes } : {}),
    });
  };

  /** Receiver side: copy this device's file fingerprints so the sender can leave those files out of a delta. */
  const copyMyFingerprints = async () => {
    try {
      const files = await readAllSyncFiles();
      await navigator.clipboard.writeText(await localFingerprintText(files));
      toast.push({ text: t('options.sync.fingerprintsCopied', { n: files.length }) });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleExportRaf = async () => {
    setBusy(true);
    try {
      const bytes = await buildEncryptedBytes();
      if (!bytes) return;
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy.buffer], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `resume-autofill-${mode}.raf`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setBusy(false);
    }
  };

  const enterIncomingBytes = async (bytes: Uint8Array) => {
    setError(null);
    setUnlockError(null);
    const inspected = inspectSyncArchive(bytes);
    if (inspected.kind === 'invalid') {
      setError(t('options.sync.badArchive'));
      return;
    }
    if (inspected.kind === 'plain-json') {
      const payload = await unlockSyncArchive(bytes);
      await openMergePreview(payload);
      return;
    }
    setLockedBytes(bytes);
    setUnlockPass('');
  };

  const openMergePreview = async (payload: UnlockedSyncPayload) => {
    const existingTracker = await loadApplications().catch(() => []);
    setTrackerExistingCount(existingTracker.length);
    setUnlocked(payload);
    if (profile) {
      const plan = planSyncMerge(profile, payload, existingTracker);
      setAdoptIds(new Set(plan.resumes.filter((i) => i.defaultUseIncoming).map((i) => i.resume.id)));
    } else {
      setAdoptIds(new Set(payload.profile.resumes.map((r) => r.id)));
    }
  };

  const handleUnlock = async () => {
    if (!lockedBytes) return;
    setUnlockError(null);
    setBusy(true);
    try {
      const payload = await unlockSyncArchive(lockedBytes, unlockPass);
      setLockedBytes(null);
      setUnlockPass('');
      await openMergePreview(payload);
    } catch (err) {
      if (err instanceof RafError && err.code === 'wrong_password') {
        setUnlockError(t('options.sync.wrongPassword'));
      } else if (err instanceof RafError && err.code === 'tampered') {
        setUnlockError(t('options.sync.tampered'));
      } else if (err instanceof RafError && err.code === 'outdated_archive') {
        setUnlockError(t('options.sync.outdatedArchive'));
      } else {
        setUnlockError(t('options.sync.badArchive'));
      }
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (file: File) => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    await enterIncomingBytes(bytes);
  };

  const handleApplyMerge = async (strategy: 'merge' | 'replace') => {
    if (!unlocked || !profile) return;
    setBusy(true);
    setError(null);
    const storage = extensionStorageAdapter();
    let result: Awaited<ReturnType<typeof applySyncMerge>>;
    try {
      const existingTracker = await loadApplications().catch(() => []);
      result = await applySyncMerge(profile, unlocked, existingTracker, storage, {
        strategy,
        adoptIds,
        includeTracker: true,
      });
      await onApplyProfile(result.profile);
      await saveApplications(
        strategy === 'replace' ? result.tracker : mergeTrackerRecords(existingTracker, result.tracker),
      );
    } catch (err) {
      setError(
        err instanceof SyncMergeError
          ? t('options.sync.missingKnownFile')
          : t('options.sync.applyFailed', { error: err instanceof Error ? err.message : String(err) }),
      );
      setBusy(false);
      return;
    }
    try {
      // Only now, with the new profile and records stored, remove files nothing points to any more.
      await deleteOrphanFiles(storage, result.orphanFileIds);
      setUnlocked(null);
      toast.push({ text: t('options.sync.done', { n: result.adoptedResumes }) });
    } catch (err) {
      setUnlocked(null);
      setError(t('options.sync.cleanupFailed', { error: err instanceof Error ? err.message : String(err) }));
    } finally {
      setBusy(false);
    }
  };

  const closeRtc = () => {
    senderRef.current?.close();
    receiverRef.current?.close();
    senderRef.current = null;
    receiverRef.current = null;
    setRtcRole('idle');
    setOfferToken('');
    setAnswerToken('');
    setRemoteSignalInput('');
    setMdnsWarn(false);
    setProgress(null);
  };

  const startSender = async () => {
    closeRtc();
    setError(null);
    if ([...passphrase.normalize('NFC')].length < RAF_MIN_PASSWORD_LENGTH) {
      setError(t('options.sync.passwordShort'));
      return;
    }
    try {
      const session = await createSenderSession();
      senderRef.current = session;
      setRtcRole('sender');
      setOfferToken(session.offerToken);
      setMdnsWarn(session.mdnsOnly);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const connectAndSend = async () => {
    if (!senderRef.current || !remoteSignalInput.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const rafBytes = await buildEncryptedBytes();
      if (!rafBytes) return;
      await senderRef.current.acceptAnswerAndSend(remoteSignalInput.trim(), rafBytes, (done, total) => {
        setProgress({ done, total });
      });
      toast.push({ text: t('options.sync.done', { n: profile?.resumes.length ?? 0 }) });
      closeRtc();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const startReceiver = () => {
    closeRtc();
    setError(null);
    setRtcRole('receiver');
  };

  const generateAnswer = async () => {
    if (!remoteSignalInput.trim()) return;
    setError(null);
    try {
      const session = await createReceiverSession(remoteSignalInput.trim(), (done, total) => {
        setProgress({ done, total });
      });
      receiverRef.current = session;
      setAnswerToken(session.answerToken);
      setMdnsWarn(session.mdnsOnly);
      void session.receivePromise
        .then(async (bytes) => {
          closeRtc();
          await enterIncomingBytes(bytes);
        })
        .catch((err) => {
          setError(err instanceof Error ? err.message : String(err));
        });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const readQrFromFile = async (file: File) => {
    const decoded = await decodeQrImageFile(file);
    if (!decoded) {
      setError(t('options.sync.qrImgUnsupported'));
      return;
    }
    setRemoteSignalInput(decoded);
  };

  const toggleAdopt = (id: string) => {
    setAdoptIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="raf-form-stack">
      <Divider />
      <h3 className="raf-heading">{t('options.sync.title')}</h3>
      <Notice>{t('options.sync.lead')}</Notice>

      <div className="raf-form-stack raf-form-stack--cols">
        <Segmented<SyncMode>
          label={t('options.sync.modeLabel')}
          visibleLabel
          value={mode}
          options={[
            { value: 'light', label: t('options.sync.modeLight') },
            { value: 'full', label: t('options.sync.modeFull') },
          ]}
          onChange={setMode}
        />
        <Field label={t('options.sync.password')} help={t('options.sync.passwordHint')}>
          {(ctrl) => (
            <Input
              {...ctrl}
              type="password"
              autoComplete="new-password"
              value={passphrase}
              onChange={(e) => setPassphrase(e.target.value)}
            />
          )}
        </Field>
      </div>

      <div className="raf-form-stack">
        <label className="raf-check">
          <input type="checkbox" checked={deltaMode} onChange={(e) => setDeltaMode(e.target.checked)} />
          <span>{t('options.sync.deltaToggle')}</span>
        </label>
        {deltaMode ? (
          <div className="raf-form-stack">
            <Field label={t('options.sync.knownHashesLabel')}>
              {(ctrl) => (
                <Textarea
                  {...ctrl}
                  rows={2}
                  value={knownHashesInput}
                  onChange={(e) => setKnownHashesInput(e.target.value)}
                />
              )}
            </Field>
          </div>
        ) : null}
      </div>

      <p className="raf-caption">{t('options.sync.copyFingerprintsHint')}</p>
      <div className="raf-row">
        <Button icon="download" variant="primary" disabled={!profile || busy} onClick={() => void handleExportRaf()}>
          {t('options.sync.exportRaf')}
        </Button>
        <Button icon="upload" disabled={busy} onClick={() => fileInputRef.current?.click()}>
          {t('options.sync.importRaf')}
        </Button>
        <Button icon="copy" disabled={busy} onClick={() => void copyMyFingerprints()}>
          {t('options.sync.copyFingerprints')}
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          hidden
          accept=".raf,.json,application/json,application/octet-stream"
          aria-label={t('options.sync.importRaf')}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void handleImportFile(file);
          }}
        />
      </div>

      {lockedBytes ? (
        <div className="raf-sync-box">
          <strong>{t('options.sync.unlockTitle')}</strong>
          <p className="raf-caption">{t('options.sync.unlockHint')}</p>
          <Field label={t('options.sync.password')} error={unlockError}>
            {(ctrl) => (
              <Input
                {...ctrl}
                type="password"
                autoComplete="current-password"
                value={unlockPass}
                onChange={(e) => setUnlockPass(e.target.value)}
              />
            )}
          </Field>
          <div className="raf-row">
            <Button variant="primary" disabled={busy} onClick={() => void handleUnlock()}>
              {t('options.sync.unlock')}
            </Button>
            <Button onClick={() => setLockedBytes(null)}>{t('options.notNow')}</Button>
          </div>
        </div>
      ) : null}

      {unlocked && mergePlan ? (
        <div className="raf-sync-box" role="region" aria-label={t('options.sync.mergeTitle')}>
          <strong>{t('options.sync.mergeTitle')}</strong>
          <p className="raf-caption">
            {t('options.sync.mergeSummary', {
              resumes: unlocked.profile.resumes.length,
              tracker: unlocked.tracker.length,
              files: unlocked.attachments.length,
            })}
            {trackerExistingCount > 0 && unlocked.tracker.length > 0
              ? ` (+${mergePlan.trackerNewOrUpdated})`
              : ''}
          </p>
          {unlocked.format === 'raf-v3' ? (
            <Notice tone="info">
              {t('options.sync.deltaBadge', { n: unlocked.skippedHashes?.length ?? 0 })}
            </Notice>
          ) : null}
          <ul className="raf-sync-diff-list">
            {mergePlan.resumes.map((item) => {
              const checked = adoptIds.has(item.resume.id);
              const badgeKey =
                item.kind === 'add'
                  ? 'options.sync.diffAdd'
                  : item.kind === 'incoming_newer'
                    ? 'options.sync.diffNewer'
                    : 'options.sync.diffLocalNewer';
              return (
                <li key={item.resume.id} className="raf-sync-diff-row">
                  <label className="raf-check">
                    <input type="checkbox" checked={checked} onChange={() => toggleAdopt(item.resume.id)} />
                    <span>{item.resume.title || item.resume.id}</span>
                  </label>
                  <Badge>{t(badgeKey)}</Badge>
                </li>
              );
            })}
          </ul>
          <div className="raf-row">
            <Button variant="primary" disabled={busy} onClick={() => void handleApplyMerge('merge')}>
              {t('options.sync.applyMerge')}
            </Button>
            <Button variant="danger" disabled={busy} onClick={() => void handleApplyMerge('replace')}>
              {t('options.sync.applyReplace')}
            </Button>
            <Button onClick={() => setUnlocked(null)}>{t('options.notNow')}</Button>
          </div>
        </div>
      ) : null}

      <div className="raf-sync-box">
        <strong>{t('options.sync.webrtcTitle')}</strong>
        <p className="raf-caption">{t('options.sync.webrtcLead')}</p>
        <div className="raf-row">
          <Button icon="arrow-left-right" disabled={!profile || busy} onClick={() => void startSender()}>
            {t('options.sync.startSend')}
          </Button>
          <Button icon="upload" disabled={busy} onClick={startReceiver}>
            {t('options.sync.startReceive')}
          </Button>
          {rtcRole !== 'idle' ? <Button onClick={closeRtc}>{t('options.sync.closeSession')}</Button> : null}
        </div>

        {mdnsWarn ? <Notice tone="info">{t('options.sync.mdnsWarn')}</Notice> : null}

        {rtcRole === 'sender' && offerToken ? (
          <div className="raf-sync-rtc">
            {offerQrDataUrl ? (
              <img className="raf-qr-img" src={offerQrDataUrl} alt={t('options.sync.offerQr')} />
            ) : null}
            <div className="raf-row">
              <Button
                icon="copy"
                onClick={() => {
                  void navigator.clipboard?.writeText(offerToken);
                  toast.push({ text: t('options.sync.copied') });
                }}
              >
                {t('options.sync.copySignal')}
              </Button>
            </div>
            <Field label={t('options.sync.pasteAnswer')}>
              {(ctrl) => (
                <Textarea
                  {...ctrl}
                  rows={2}
                  value={remoteSignalInput}
                  onChange={(e) => setRemoteSignalInput(e.target.value)}
                />
              )}
            </Field>
            <div className="raf-row">
              <Button variant="primary" disabled={busy || !remoteSignalInput.trim()} onClick={() => void connectAndSend()}>
                {t('options.sync.connectSend')}
              </Button>
              <Button onClick={() => qrImgInputRef.current?.click()}>{t('options.sync.uploadQrImg')}</Button>
            </div>
          </div>
        ) : null}

        {rtcRole === 'receiver' ? (
          <div className="raf-sync-rtc">
            <Field label={t('options.sync.pasteOffer')}>
              {(ctrl) => (
                <Textarea
                  {...ctrl}
                  rows={2}
                  value={remoteSignalInput}
                  onChange={(e) => setRemoteSignalInput(e.target.value)}
                />
              )}
            </Field>
            <div className="raf-row">
              <Button variant="primary" disabled={!remoteSignalInput.trim()} onClick={() => void generateAnswer()}>
                {t('options.sync.genAnswer')}
              </Button>
              <Button onClick={() => qrImgInputRef.current?.click()}>{t('options.sync.uploadQrImg')}</Button>
            </div>
            {answerToken ? (
              <div className="raf-sync-rtc">
                {offerQrDataUrl ? (
                  <img className="raf-qr-img" src={offerQrDataUrl} alt={t('options.sync.offerQr')} />
                ) : null}
                <Button
                  icon="copy"
                  onClick={() => {
                    void navigator.clipboard?.writeText(answerToken);
                    toast.push({ text: t('options.sync.copied') });
                  }}
                >
                  {t('options.sync.copySignal')}
                </Button>
              </div>
            ) : null}
          </div>
        ) : null}

        <input
          ref={qrImgInputRef}
          type="file"
          hidden
          accept="image/*"
          onChange={(e) => {
            const img = e.target.files?.[0];
            e.target.value = '';
            if (img) void readQrFromFile(img);
          }}
        />
        {progress ? (
          <p className="raf-caption">{t('options.sync.transferProgress', { done: progress.done, total: progress.total })}</p>
        ) : null}
      </div>

      {error ? <Notice tone="danger">{error}</Notice> : null}
    </div>
  );
}
