// Mobile encrypted `.raf` export/import + SHA-256 deduplicated attachment merge + zero-relay LAN WebRTC sync sheet.
import { useMemo, useRef, useState } from 'react';
import type { Profile } from '../../../../src/schema';
import {
  RAF_MIN_PASSWORD_LENGTH,
  RafError,
  applySyncMerge,
  buildRafArchive,
  createReceiverSession,
  createSenderSession,
  inspectSyncArchive,
  planSyncMerge,
  renderQrSvg,
  unlockSyncArchive,
  type SyncAttachmentInput,
  type SyncMode,
  type SyncStorageAdapter,
  type UnlockedSyncPayload,
} from '../../../../src/sync';
import { Notice, PasswordField } from '../dialogs';
import { useMT } from '../i18n';
import type { AppState } from '../store/appStateStore';
import { readBlob, type FileStore } from '../store/fileStore';
import { emptyProfile } from '../store/profileStore';
import { Sheet, type ToastMessage } from '../ui';
import type { SaveDocument } from './ExportSheet';

export interface SyncSheetProps {
  open: boolean;
  onClose: () => void;
  profile: Profile | null;
  readStoredProfile: () => Promise<Profile>;
  onApplyProfile?: (profile: Profile) => void;
  files: FileStore;
  appState: AppState;
  updateAppState: (change: (s: AppState) => AppState) => Promise<boolean>;
  saveDocument?: SaveDocument;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

function makeMobileStorageAdapter(files: FileStore): SyncStorageAdapter {
  return {
    async listExistingFiles() {
      const ids = await files.list();
      const out: Array<{ id: string; bytes: Uint8Array }> = [];
      for (const id of ids) {
        const entry = await files.read(id);
        if (entry) out.push({ id, bytes: entry.bytes });
      }
      return out;
    },
    async saveFile(input) {
      const saved = await files.put({ name: input.name, type: input.type, bytes: input.bytes });
      return saved.id;
    },
    deleteFile: (id) => files.remove(id),
  };
}

export function SyncSheet(props: SyncSheetProps) {
  const t = useMT();
  return (
    <Sheet open={props.open} title={t('m.sync.title')} onClose={props.onClose}>
      <SyncSheetBody {...props} />
    </Sheet>
  );
}

function SyncSheetBody({
  onClose,
  profile,
  readStoredProfile,
  onApplyProfile,
  files,
  appState,
  updateAppState,
  saveDocument,
  showToast,
}: SyncSheetProps) {
  const t = useMT();
  const [mode, setMode] = useState<SyncMode>('full');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [lockedBytes, setLockedBytes] = useState<Uint8Array | null>(null);
  const [unlockPass, setUnlockPass] = useState('');
  const [unlockErr, setUnlockErr] = useState<string | null>(null);
  const [unlocked, setUnlocked] = useState<UnlockedSyncPayload | null>(null);

  const [rtcMode, setRtcMode] = useState<'idle' | 'send' | 'recv'>('idle');
  const [signalOut, setSignalOut] = useState('');
  const [remoteSignal, setRemoteSignal] = useState('');
  const [mdnsWarn, setMdnsWarn] = useState(false);
  const senderRef = useRef<Awaited<ReturnType<typeof createSenderSession>> | null>(null);
  const receiverRef = useRef<Awaited<ReturnType<typeof createReceiverSession>> | null>(null);
  const pickerRef = useRef<HTMLInputElement>(null);

  const qrDataUrl = useMemo(() => {
    if (!signalOut) return null;
    try {
      return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderQrSvg(signalOut, t('m.sync.webrtcTitle')))}`;
    } catch {
      return null;
    }
  }, [signalOut, t]);

  const buildArchive = async (): Promise<Uint8Array | null> => {
    if ([...password.normalize('NFC')].length < RAF_MIN_PASSWORD_LENGTH) {
      setError(t('m.sync.passShort'));
      return null;
    }
    setError(null);
    const stored = await readStoredProfile();
    const attachments: SyncAttachmentInput[] = [];
    if (mode === 'full') {
      const ids = await files.list();
      for (const id of ids) {
        const entry = await files.read(id);
        if (entry) attachments.push({ id, name: entry.info.name, type: entry.info.type, bytes: entry.bytes });
      }
    }
    return buildRafArchive({
      profile: stored,
      tracker: appState.applications,
      attachments,
      mode,
      password,
    });
  };

  const handleExport = async () => {
    if (!saveDocument) return;
    setBusy(true);
    try {
      const bytes = await buildArchive();
      if (!bytes) return;
      const res = await saveDocument({
        name: `resume-autofill-${mode}.raf`,
        mimeType: 'application/octet-stream',
        bytes,
      });
      if (res === 'saved') {
        setPassword('');
        onClose();
        showToast({ text: t('m.export.done') });
      }
    } finally {
      setBusy(false);
    }
  };

  const enterBytes = async (bytes: Uint8Array) => {
    setError(null);
    setUnlockErr(null);
    const inspected = inspectSyncArchive(bytes);
    if (inspected.kind === 'invalid') {
      setError(t('m.sync.badArchive'));
      return;
    }
    if (inspected.kind === 'plain-json') {
      setUnlocked(await unlockSyncArchive(bytes));
      return;
    }
    setLockedBytes(bytes);
    setUnlockPass('');
  };

  const handleUnlock = async () => {
    if (!lockedBytes) return;
    setBusy(true);
    setUnlockErr(null);
    try {
      const payload = await unlockSyncArchive(lockedBytes, unlockPass);
      setLockedBytes(null);
      setUnlockPass('');
      setUnlocked(payload);
    } catch (err) {
      if (err instanceof RafError && err.code === 'wrong_password') setUnlockErr(t('m.sync.wrongPass'));
      else setUnlockErr(t('m.sync.badArchive'));
    } finally {
      setBusy(false);
    }
  };

  const handleApply = async (strategy: 'merge' | 'replace') => {
    if (!unlocked) return;
    setBusy(true);
    try {
      const base = profile ?? emptyProfile();
      const result = await applySyncMerge(base, unlocked, appState.applications, makeMobileStorageAdapter(files), {
        strategy,
        includeTracker: true,
      });
      onApplyProfile?.(result.profile);
      await updateAppState((s) => ({ ...s, applications: result.tracker }));
      setUnlocked(null);
      onClose();
      showToast({ text: t('m.sync.done', { n: result.adoptedResumes }) });
    } finally {
      setBusy(false);
    }
  };

  const closeRtc = () => {
    senderRef.current?.close();
    receiverRef.current?.close();
    senderRef.current = null;
    receiverRef.current = null;
    setRtcMode('idle');
    setSignalOut('');
    setRemoteSignal('');
    setMdnsWarn(false);
  };

  const startOffer = async () => {
    closeRtc();
    setError(null);
    if ([...password.normalize('NFC')].length < RAF_MIN_PASSWORD_LENGTH) {
      setError(t('m.sync.passShort'));
      return;
    }
    try {
      const s = await createSenderSession();
      senderRef.current = s;
      setRtcMode('send');
      setSignalOut(s.offerToken);
      setMdnsWarn(s.mdnsOnly);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const sendViaRtc = async () => {
    if (!senderRef.current || !remoteSignal.trim()) return;
    setBusy(true);
    setError(null);
    try {
      const raf = await buildArchive();
      if (!raf) return;
      await senderRef.current.acceptAnswerAndSend(remoteSignal.trim(), raf);
      closeRtc();
      onClose();
      showToast({ text: t('m.export.done') });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const genAnswer = async () => {
    if (!remoteSignal.trim()) return;
    setError(null);
    try {
      const r = await createReceiverSession(remoteSignal.trim());
      receiverRef.current = r;
      setSignalOut(r.answerToken);
      setMdnsWarn(r.mdnsOnly);
      void r.receivePromise
        .then(async (bytes) => {
          closeRtc();
          await enterBytes(bytes);
        })
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const mergePlan = useMemo(
    () => (unlocked ? planSyncMerge(profile ?? emptyProfile(), unlocked, appState.applications) : null),
    [unlocked, profile, appState.applications],
  );

  return (
    <div className="m-sheet-stack">
      <Notice icon="lock">{t('m.sync.lead')}</Notice>

      <div className="m-row">
        <label className="m-check">
          <input type="radio" name="raf-mode" checked={mode === 'light'} onChange={() => setMode('light')} />
          <span>{t('m.sync.light')}</span>
        </label>
        <label className="m-check">
          <input type="radio" name="raf-mode" checked={mode === 'full'} onChange={() => setMode('full')} />
          <span>{t('m.sync.full')}</span>
        </label>
      </div>

      <PasswordField label={t('m.sync.pass')} value={password} onChange={setPassword} autoComplete="new-password" error={error} />

      <button type="button" className="m-button m-button--primary m-button--wide" disabled={busy || !saveDocument} onClick={() => void handleExport()}>
        {t('m.sync.exportRaf')}
      </button>
      <button type="button" className="m-button m-button--wide" disabled={busy} onClick={() => pickerRef.current?.click()}>
        {t('m.sync.importRaf')}
      </button>
      <input
        ref={pickerRef}
        type="file"
        hidden
        accept=".raf,.json,application/json,application/octet-stream"
        aria-label={t('m.sync.importRaf')}
        onChange={async (e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) await enterBytes(await readBlob(f));
        }}
      />

      {lockedBytes ? (
        <div className="m-card m-sheet-stack">
          <strong>{t('m.sync.unlock')}</strong>
          <p className="m-row__caption">{t('m.sync.unlockHint')}</p>
          <PasswordField label={t('m.sync.pass')} value={unlockPass} onChange={setUnlockPass} autoComplete="current-password" error={unlockErr} />
          <button type="button" className="m-button m-button--primary m-button--wide" disabled={busy} onClick={() => void handleUnlock()}>
            {t('m.sync.unlock')}
          </button>
        </div>
      ) : null}

      {unlocked && mergePlan ? (
        <div className="m-card m-sheet-stack">
          <strong>{t('m.sync.mergeTitle')}</strong>
          <p className="m-row__caption">
            {t('m.sync.mergeCount', {
              resumes: unlocked.profile.resumes.length,
              tracker: unlocked.tracker.length,
              files: unlocked.attachments.length,
            })}
          </p>
          {unlocked.format === 'raf-v3' ? (
            <Notice tone="info">
              {t('m.sync.deltaV3Info', { n: unlocked.skippedHashes?.length ?? 0 })}
            </Notice>
          ) : null}
          <button type="button" className="m-button m-button--primary m-button--wide" disabled={busy} onClick={() => void handleApply('merge')}>
            {t('m.sync.mergeBtn')}
          </button>
          <button type="button" className="m-button m-button--danger m-button--wide" disabled={busy} onClick={() => void handleApply('replace')}>
            {t('m.sync.replaceBtn')}
          </button>
        </div>
      ) : null}

      <div className="m-card m-sheet-stack">
        <strong>{t('m.sync.webrtcTitle')}</strong>
        <p className="m-row__caption">{t('m.sync.webrtcHint')}</p>
        {mdnsWarn ? <Notice tone="warning">{t('m.sync.mdnsWarn')}</Notice> : null}
        <button type="button" className="m-button m-button--wide" onClick={() => void startOffer()}>
          {t('m.sync.genOffer')}
        </button>
        <button
          type="button"
          className="m-button m-button--wide"
          onClick={() => {
            closeRtc();
            setRtcMode('recv');
          }}
        >
          {t('m.sync.useOffer')}
        </button>

        {rtcMode !== 'idle' ? (
          <>
            {qrDataUrl ? <img src={qrDataUrl} alt={t('m.sync.webrtcTitle')} style={{ width: 180, height: 180, alignSelf: 'center' }} /> : null}
            {signalOut ? (
              <button
                type="button"
                className="m-button m-button--wide"
                onClick={() => {
                  void navigator.clipboard?.writeText(signalOut);
                  showToast({ text: t('m.sync.copied') });
                }}
              >
                {t('m.sync.copyToken')}
              </button>
            ) : null}
            <label className="m-field">
              <span className="m-field__label">{t('m.sync.pasteToken')}</span>
              <textarea className="m-input" rows={2} value={remoteSignal} onChange={(e) => setRemoteSignal(e.target.value)} />
            </label>
            {rtcMode === 'send' ? (
              <button type="button" className="m-button m-button--primary m-button--wide" disabled={busy || !remoteSignal.trim()} onClick={() => void sendViaRtc()}>
                {t('m.sync.sendNow')}
              </button>
            ) : (
              <button type="button" className="m-button m-button--primary m-button--wide" disabled={!remoteSignal.trim()} onClick={() => void genAnswer()}>
                {t('m.sync.genAnswer')}
              </button>
            )}
          </>
        ) : null}
      </div>
    </div>
  );
}
