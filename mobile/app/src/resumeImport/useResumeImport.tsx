// The resume import's flow: pick a PDF or Word file (or take one another app sent, or a stored resume PDF), read it,
// explain a failure or review what was read, then save it as a new resume or merge it into one, with undo. The
// review lives in memory only; nothing reaches the profile store or the file store before 导入 / 确认合并. Each run
// carries a token, so a late result from a cancelled or replaced run counts for nothing.
import { useCallback, useContext, useEffect, useId, useReducer, useRef, useState, type ReactNode } from 'react';
import { newResumeId } from '../../../../src/editor';
import { useLanguage } from '../../../../src/i18n';
import { titleFromFileName } from '../../../../src/import/parse/clean';
import type { Locale, Profile } from '../../../../src/schema';
import { ConfirmSheet, Notice } from '../dialogs';
import { useMT } from '../i18n';
import { readBlob, type FileStore } from '../store/fileStore';
import { BackStackContext, Sheet, type ToastMessage } from '../ui';
import { FailureScreen } from './FailureScreen';
import { ImportOverlay } from './ImportOverlay';
import type { IncomingEvent, IncomingFileSource } from './incoming';
import { buildImport, undoImport, type MergePlan } from './merge';
import { MergePreviewSheet } from './MergePreviewSheet';
import { ProgressScreen } from './ProgressScreen';
import { initReview, isDirty, reviewReduce, type ReviewAction, type ReviewState } from './review';
import { ReviewScreen, planOf } from './ReviewScreen';
import {
  DOCX_MIME,
  IMPORT_ACCEPT,
  IMPORT_MAX_BYTES,
  PDF_MIME,
  type ImportFailure,
  type ImportFile,
  type ImportKind,
  type ReadOutcome,
  type ReadPhase,
  type ResumeReader,
} from './types';

export interface ResumeImportDeps {
  profile: Profile | null;
  loadError: string | null;
  /** True once profile or loadError is known. Incoming files wait for it. */
  ready: boolean;
  edit: (change: (p: Profile) => Profile, options?: { immediate?: boolean }) => void;
  files: FileStore;
  reader: ResumeReader;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  /** App's hold(): a file just stored, not yet referenced. */
  onStored: (id: string) => void;
  /** After a successful import: App jumps to the resume / finishes onboarding. */
  onImported: (resumeId: string) => void;
  /** 新建空白简历 on the explanation screen. */
  onStartBlank: (locale: Locale) => void;
  incoming?: IncomingFileSource;
}

export interface ResumeImport {
  /** Opens the system picker. */
  pick: () => void;
  /** Reads a stored attachment (no picker). */
  openStored: (fileId: string, resumeId: string) => void;
  /** True while the overlay is shown: App hides the tab bar and makes the shell inert. */
  open: boolean;
  /**
   * The back key, once no sheet is left above the overlay (App asks the BackStack first). True when used: progress
   * cancels, a failure closes, a clean review closes, an edited review asks first.
   */
  back: () => boolean;
  /** The hidden input, the overlay and its sheets. */
  element: ReactNode;
}

type Step =
  | { kind: 'idle' }
  | { kind: 'reading'; name: string; size: number | null; fileKind: ImportKind; phase: ReadPhase; startedAt: number }
  | { kind: 'failed'; reason: ImportFailure; fileName: string; locale?: Locale }
  | { kind: 'blocked' }
  | { kind: 'review' }
  | { kind: 'confirmMerge'; plan: MergePlan }
  | { kind: 'applying' };

type ReviewMessage = ReviewAction | { type: 'set'; state: ReviewState | null };
const reduceReview = (state: ReviewState | null, action: ReviewMessage): ReviewState | null =>
  action.type === 'set' ? action.state : state ? reviewReduce(state, action) : state;

const kindOf = (name: string, mimeType = ''): ImportKind => (mimeType === DOCX_MIME || /\.docx$/i.test(name) ? 'docx' : 'pdf');
const OVERLAY_STEPS = new Set<Step['kind']>(['reading', 'failed', 'review', 'confirmMerge', 'applying']);

export function useResumeImport(deps: ResumeImportDeps): ResumeImport {
  const t = useMT();
  const language = useLanguage();
  const backStack = useContext(BackStackContext);
  const headingId = useId();
  const input = useRef<HTMLInputElement>(null);
  const [step, setStep] = useState<Step>({ kind: 'idle' });
  const [review, dispatchReview] = useReducer(reduceReview, null);
  const [discardOpen, setDiscardOpen] = useState(false);
  const [replacing, setReplacing] = useState<ImportFile | null>(null);
  const [targetGone, setTargetGone] = useState(false);

  const depsRef = useRef(deps);
  depsRef.current = deps;
  const tRef = useRef(t);
  tRef.current = t;
  const stepRef = useRef(step);
  stepRef.current = step;
  const reviewRef = useRef(review);
  reviewRef.current = review;

  const run = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  /** The file's bytes, kept only while the PDF might still be stored as the attachment. */
  const bytesRef = useRef<Uint8Array | null>(null);
  /** An incoming file announced as being read: its run token and name. */
  const pendingIncoming = useRef<{ token: number; name: string } | null>(null);
  /** The incoming file being read was cancelled: its file or error, when it comes, is dropped. */
  const cancelledIncoming = useRef(false);
  /** Files from other apps that came while an import was being saved; handled once it is done. */
  const deferredIncoming = useRef<IncomingEvent[]>([]);
  /** What had the focus when the flow was opened; it gets the focus back on close. */
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const runs = run;
    const abort = abortRef;
    return () => {
      runs.current += 1;
      abort.current?.abort();
    };
  }, []);

  const defaultTitle = useCallback((locale: Locale) => tRef.current(locale.startsWith('zh') ? 'm.defaultTitle.zh' : 'm.defaultTitle.en'), []);

  /** Back to nothing shown; a late result from the run that was going counts for nothing. */
  const close = useCallback(() => {
    run.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    bytesRef.current = null;
    if (pendingIncoming.current) cancelledIncoming.current = true;
    pendingIncoming.current = null;
    dispatchReview({ type: 'set', state: null });
    setDiscardOpen(false);
    setReplacing(null);
    setTargetGone(false);
    setStep({ kind: 'idle' });
  }, []);

  const block = useCallback(() => {
    run.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    dispatchReview({ type: 'set', state: null });
    setStep({ kind: 'blocked' });
  }, []);

  const startRead = useCallback(
    async (file: ImportFile) => {
      if (depsRef.current.loadError || !depsRef.current.profile) return block();
      abortRef.current?.abort();
      const token = ++run.current;
      const live = () => run.current === token;
      const controller = new AbortController();
      abortRef.current = controller;
      bytesRef.current = file.bytes;
      pendingIncoming.current = null;
      dispatchReview({ type: 'set', state: null });
      setDiscardOpen(false);
      setReplacing(null);
      setTargetGone(false);
      setStep({ kind: 'reading', name: file.name, size: file.bytes.length, fileKind: kindOf(file.name, file.mimeType), phase: 'reading', startedAt: Date.now() });
      let outcome: ReadOutcome;
      try {
        outcome = await depsRef.current.reader(file, {
          signal: controller.signal,
          onPhase: (phase) => {
            if (live()) setStep((s) => (s.kind === 'reading' ? { ...s, phase } : s));
          },
        });
      } catch {
        outcome = { ok: false, reason: 'failed' };
      }
      if (!live()) return;
      abortRef.current = null;
      if (!outcome.ok) {
        if (outcome.reason === 'cancelled') return close();
        bytesRef.current = null;
        setStep({ kind: 'failed', reason: outcome.reason, fileName: file.name, locale: outcome.locale });
        return;
      }
      const state = initReview(outcome, file, depsRef.current.profile, defaultTitle);
      if (outcome.kind !== 'pdf' || file.source === 'attachment') bytesRef.current = null;
      dispatchReview({ type: 'set', state });
      setStep({ kind: 'review' });
    },
    [block, close, defaultTitle],
  );

  const pick = useCallback(() => {
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (depsRef.current.loadError) return block();
    input.current?.click();
  }, [block]);

  const onPicked = async (file: File | undefined) => {
    if (!file) return; // picker cancelled: nothing changes, nothing is shown
    const name = file.name.slice(0, 128);
    if (depsRef.current.loadError || !depsRef.current.profile) return block();
    const token = ++run.current;
    abortRef.current?.abort();
    abortRef.current = null;
    if (file.size > IMPORT_MAX_BYTES) return setStep({ kind: 'failed', reason: 'too_large', fileName: name });
    if (file.size === 0) return setStep({ kind: 'failed', reason: 'empty', fileName: name });
    setStep({ kind: 'reading', name, size: file.size, fileKind: kindOf(name, file.type), phase: 'reading', startedAt: Date.now() });
    let bytes: Uint8Array;
    try {
      bytes = await readBlob(file);
    } catch {
      if (run.current === token) setStep({ kind: 'failed', reason: 'unreadable', fileName: name });
      return;
    }
    if (run.current !== token) return;
    await startRead({ name, mimeType: file.type, bytes, source: 'picker' });
  };

  const openStored = useCallback(
    (fileId: string, resumeId: string) => {
      openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      if (depsRef.current.loadError) return block();
      const token = ++run.current;
      abortRef.current?.abort();
      abortRef.current = null;
      setStep({ kind: 'reading', name: '', size: null, fileKind: 'pdf', phase: 'reading', startedAt: Date.now() });
      void (async () => {
        const got = await depsRef.current.files.read(fileId).catch(() => null);
        if (run.current !== token) return;
        if (!got) return setStep({ kind: 'failed', reason: 'unreadable', fileName: '' });
        await startRead({ name: got.info.name, mimeType: got.info.type, bytes: got.bytes, source: 'attachment', stored: { fileId, resumeId } });
      })();
    },
    [block, startRead],
  );

  const cancel = useCallback(() => {
    close();
    depsRef.current.showToast({ text: tRef.current('m.ri.cancelled') });
  }, [close]);

  // ------------------------------------------------------------------ files from other apps
  const onIncoming = (event: IncomingEvent) => {
    // Nothing may sit above the overlay: close every open sheet first (the overlay itself is not on the stack).
    for (let i = 0; i < 50 && backStack.pop(); i += 1);
    const s = stepRef.current;
    const current = reviewRef.current;
    const dirtyReview = (s.kind === 'review' || s.kind === 'confirmMerge') && current !== null && isDirty(current);
    if (s.kind === 'applying') {
      // Taken from the native slot already: kept until the import is saved, then handled as if it came then.
      deferredIncoming.current.push(event);
      return;
    }
    if (depsRef.current.loadError || !depsRef.current.profile) return block();
    if (event.kind === 'reading') {
      cancelledIncoming.current = false;
      if (dirtyReview) return; // asked about once the file is there
      abortRef.current?.abort();
      abortRef.current = null;
      const token = ++run.current;
      pendingIncoming.current = { token, name: event.name };
      bytesRef.current = null;
      dispatchReview({ type: 'set', state: null });
      setStep({ kind: 'reading', name: event.name, size: null, fileKind: kindOf(event.name), phase: 'reading', startedAt: Date.now() });
      return;
    }
    const pending = pendingIncoming.current;
    pendingIncoming.current = null;
    if (cancelledIncoming.current) {
      cancelledIncoming.current = false; // cancelled while the phone was still reading it
      return;
    }
    if (pending && pending.token !== run.current) return; // replaced while the phone was still reading it
    if (event.kind === 'error') {
      if (dirtyReview) return; // the edits stay; the failed file is simply not taken
      run.current += 1;
      abortRef.current?.abort();
      abortRef.current = null;
      dispatchReview({ type: 'set', state: null });
      setStep({ kind: 'failed', reason: event.reason, fileName: pending?.name ?? '' });
      return;
    }
    if (dirtyReview) {
      setStep({ kind: 'review' });
      setReplacing(event.file);
      return;
    }
    void startRead(event.file);
  };
  const incomingRef = useRef(onIncoming);
  incomingRef.current = onIncoming;
  const { ready, incoming } = deps;
  useEffect(() => {
    if (!ready || !incoming) return;
    return incoming.subscribe((event) => incomingRef.current(event));
  }, [ready, incoming]);
  // Once an import is no longer being saved, the files that came meanwhile, in order.
  useEffect(() => {
    if (step.kind === 'applying' || deferredIncoming.current.length === 0) return;
    const events = deferredIncoming.current;
    deferredIncoming.current = [];
    for (const event of events) incomingRef.current(event);
  }, [step.kind]);

  // ------------------------------------------------------------------ 导入 / 合并
  const apply = async () => {
    const state = reviewRef.current;
    const { profile, files, onStored } = depsRef.current;
    if (!state) return;
    if (!profile) return block();
    const token = run.current;
    setStep({ kind: 'applying' });
    let attachmentId: string | null = null;
    let attachFailed = false;
    const bytes = bytesRef.current;
    if (state.attachPdf && state.file.kind === 'pdf' && state.file.source !== 'attachment' && bytes) {
      try {
        const stored = await files.put({ name: state.file.name || tRef.current('m.ri.attachName'), type: PDF_MIME, bytes });
        attachmentId = stored.id;
        onStored(stored.id);
      } catch {
        attachFailed = true;
      }
    } else if (state.file.source === 'attachment' && state.target.kind === 'new' && state.file.stored) {
      attachmentId = state.file.stored.fileId;
    }
    if (run.current !== token) return;
    const latest = depsRef.current.profile ?? profile;
    const result = buildImport(state, latest, { newId: newResumeId, now: Date.now(), attachmentId, defaultTitle });
    if (!result.ok) {
      if (result.problem === 'target_gone') {
        setTargetGone(true);
        const locale = state.language.locale;
        dispatchReview({ type: 'target', target: { kind: 'new', locale, title: titleFromFileName(state.file.name) || defaultTitle(locale) } });
      } else if (result.problem === 'invalid') {
        depsRef.current.showToast({ text: tRef.current('m.ri.applyFailed') });
      }
      setStep({ kind: 'review' });
      return;
    }
    const { edit, showToast, onImported } = depsRef.current;
    const title = result.profile.resumes.find((r) => r.id === result.resumeId)?.title ?? '';
    const done = { resumeId: result.resumeId, before: result.before, previousActiveId: result.previousActiveId };
    edit(() => result.profile, { immediate: true });
    close();
    onImported(result.resumeId);
    const tr = tRef.current;
    showToast({
      text: attachFailed ? tr('m.ri.attachFailed') : tr(state.target.kind === 'merge' ? 'm.ri.doneMerge' : 'm.ri.doneNew', { title }),
      action: {
        label: tr('options.undo'),
        onClick: () => {
          depsRef.current.edit((p) => undoImport(p, done), { immediate: true });
          // After the toast has gone, or closing it would take this one with it.
          setTimeout(() => depsRef.current.showToast({ text: tRef.current('m.ri.undone') }), 0);
        },
      },
    });
  };

  const submit = () => {
    const state = reviewRef.current;
    if (!state) return;
    if (state.target.kind === 'merge') {
      const plan = planOf(state, depsRef.current.profile);
      if (!plan) {
        setTargetGone(true);
        const locale = state.language.locale;
        dispatchReview({ type: 'target', target: { kind: 'new', locale, title: titleFromFileName(state.file.name) || defaultTitle(locale) } });
        return;
      }
      setStep({ kind: 'confirmMerge', plan });
      return;
    }
    void apply();
  };

  const leaveReview = () => {
    const current = reviewRef.current;
    if (current && isDirty(current)) setDiscardOpen(true);
    else close();
  };

  const back = useCallback((): boolean => {
    const s = stepRef.current;
    switch (s.kind) {
      case 'reading':
        cancel();
        return true;
      case 'failed':
        close();
        return true;
      case 'review':
      case 'confirmMerge': {
        const current = reviewRef.current;
        if (current && isDirty(current)) setDiscardOpen(true);
        else close();
        return true;
      }
      case 'applying':
        return true;
      default:
        return false;
    }
  }, [cancel, close]);

  // ------------------------------------------------------------------ focus back to where the flow started
  const open = OVERLAY_STEPS.has(step.kind);
  const wasOpen = useRef(false);
  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    const opener = openerRef.current;
    openerRef.current = null;
    if (opener && opener.isConnected && !opener.closest('[inert]')) opener.focus({ preventScroll: true });
    else document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
  }, [open]);

  // ------------------------------------------------------------------ what is shown
  let screen: ReactNode = null;
  let stepKey = 'none';
  if (step.kind === 'reading') {
    stepKey = 'reading';
    screen = (
      <ProgressScreen
        headingId={headingId}
        name={step.name}
        size={step.size}
        kind={step.fileKind}
        phase={step.phase}
        startedAt={step.startedAt}
        onCancel={cancel}
      />
    );
  } else if (step.kind === 'failed') {
    stepKey = `failed:${step.reason}`;
    screen = (
      <FailureScreen
        headingId={headingId}
        reason={step.reason}
        fileName={step.fileName}
        onAnother={() => {
          close();
          input.current?.click();
        }}
        onBlank={() => {
          close();
          depsRef.current.onStartBlank(step.locale ?? (language === 'zh' ? 'zh-CN' : 'en-AU'));
        }}
        onClose={close}
      />
    );
  } else if (review && (step.kind === 'review' || step.kind === 'confirmMerge' || step.kind === 'applying')) {
    stepKey = 'review';
    screen = (
      <ReviewScreen
        state={review}
        dispatch={dispatchReview}
        profile={deps.profile}
        busy={step.kind === 'applying'}
        targetGone={targetGone}
        headingId={headingId}
        onCancel={leaveReview}
        onSubmit={submit}
      />
    );
  }

  const element = (
    <>
      <input
        ref={input}
        type="file"
        accept={IMPORT_ACCEPT}
        aria-label={t('m.ri.pickLabel')}
        hidden
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = ''; // the same file again must fire again
          void onPicked(file);
        }}
      />
      {open && screen ? (
        <ImportOverlay headingId={headingId} stepKey={stepKey}>
          {screen}
        </ImportOverlay>
      ) : null}
      <MergePreviewSheet
        open={step.kind === 'confirmMerge'}
        plan={step.kind === 'confirmMerge' ? step.plan : null}
        state={review}
        busy={false}
        onConfirm={() => void apply()}
        onClose={() => setStep((s) => (s.kind === 'confirmMerge' ? { kind: 'review' } : s))}
      />
      <ConfirmSheet
        open={discardOpen}
        title={t('m.ri.discardTitle')}
        text={t('m.ri.discardText')}
        confirmLabel={t('m.ri.discard')}
        cancelLabel={t('m.ri.keepChecking')}
        danger
        onConfirm={close}
        onClose={() => setDiscardOpen(false)}
      />
      <ConfirmSheet
        open={replacing !== null}
        title={t('m.ri.replaceTitle')}
        text={t('m.ri.replaceText', { old: review?.file.name ?? '', new: replacing?.name ?? '' })}
        confirmLabel={t('m.ri.replace')}
        cancelLabel={t('m.ri.keepChecking')}
        onConfirm={() => {
          const file = replacing;
          setReplacing(null);
          if (file) void startRead(file);
        }}
        onClose={() => setReplacing(null)}
      />
      <Sheet open={step.kind === 'blocked'} title={t('m.import.blockedTitle')} onClose={close}>
        <div className="m-sheet-stack">
          <Notice tone="danger">{t('m.import.blocked')}</Notice>
          <button type="button" className="m-button m-button--wide" onClick={close}>
            {t('m.close')}
          </button>
        </div>
      </Sheet>
    </>
  );

  return { pick, openStored, open, back, element };
}
