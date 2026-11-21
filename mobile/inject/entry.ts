// Page entry of the fill browser: injected at document start into every frame of the page WebView, bundled
// as one IIFE (engine.js). It reuses the extension's engine unchanged (scan, needs, runFill, highlights, focus) and
// talks to the app only through `rafBridge` (a WebMessageListener object). Every command is checked with the bridge
// schemas; nothing is assigned to window, no UI is added except the engine's outlines, and nothing is logged.
import { resolveAdapter } from '../../src/adapters/resolve';
import { createFrameHandlers } from '../../src/content/handlers';
import { idFor } from '../../src/content/ids';
import { createStepHandlers, type StepHandlers } from '../../src/content/steps';
import { createScanWatcher } from '../../src/content/watcher';
import { registerAllDrivers } from '../../src/drivers';
import { scanDocument } from '../../src/engine/scan';
import type { FieldReport, FillReport } from '../../src/engine/types';
import { clearHighlights } from '../../src/fill/highlight';
import { stepTitle } from '../../src/fill/nextStep';
import { runFill, type FillRun } from '../../src/fill/runFill';
import {
  MAX_CANDIDATES,
  MAX_ENTRY_INDEX,
  MAX_FRAMES,
  MAX_LABEL,
  MAX_REPORT_ROWS,
  MAX_SCAN_COUNT,
  MAX_VALUE,
  PRESS_STOPS,
  PROTOCOL_VERSION,
  decodeAppCommand,
  encode,
  readableReqId,
  type AppCommand,
  type PageMessageInput,
} from '../bridge/protocol';
import { countChildFrames } from './iframes';
import { startObstacleWatcher, type ObstacleWatcher } from './obstacles';
import { addedCards, createUndoJournal, type UndoJournal } from './undo';

interface Bridge {
  postMessage(data: string): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

const v = PROTOCOL_VERSION as 1;
const cut = (s: string, max: number) => (s.length > max ? s.slice(0, max) : s);

/** The report as the bridge schema accepts it: long texts cut, rows capped. Counts are recomputed by the app. */
function toWire(report: FillReport): FillReport {
  const fields = report.fields.slice(0, MAX_REPORT_ROWS).map((f): FieldReport => {
    const out: FieldReport = {
      fieldId: cut(f.fieldId, 64),
      label: cut(f.label ?? '', MAX_LABEL),
      fieldKey: f.fieldKey,
      section: f.section,
      outcome: f.outcome,
      confidence: Math.max(0, Math.min(1, Number.isFinite(f.confidence) ? f.confidence : 0)),
    };
    if (typeof f.value === 'string') out.value = cut(f.value, MAX_VALUE);
    if (typeof f.observed === 'string' || f.observed === null) out.observed = f.observed === null ? null : cut(f.observed, MAX_VALUE);
    if (typeof f.source === 'string') out.source = cut(f.source, 200);
    if (f.candidates) {
      out.candidates = f.candidates.slice(0, MAX_CANDIDATES).map((c) => ({
        label: cut(c.label, MAX_LABEL),
        ...(c.value !== undefined ? { value: cut(c.value, MAX_VALUE) } : {}),
        ...(c.fieldKey !== undefined ? { fieldKey: c.fieldKey } : {}),
      }));
    }
    if (f.note) out.note = f.note;
    if (typeof f.entry === 'number' && f.entry >= 0 && f.entry <= MAX_ENTRY_INDEX) out.entry = f.entry;
    return out;
  });
  const entries = (report.entries ?? [])
    .filter((e) => e.index >= 0 && e.index <= MAX_ENTRY_INDEX)
    .slice(0, MAX_REPORT_ROWS)
    .map((e) => ({
      ...e,
      ...(e.label !== undefined ? { label: cut(e.label, MAX_LABEL) } : {}),
      ...(e.button !== undefined ? { button: cut(e.button, MAX_LABEL) } : {}),
    }));
  return {
    url: cut(report.url, 2048),
    startedAt: report.startedAt,
    finishedAt: report.finishedAt,
    fields,
    counts: report.counts,
    ...(entries.length > 0 ? { entries } : {}),
  };
}

function start(bridge: Bridge, doc: Document, win: Window): void {
  const post = (message: PageMessageInput) => {
    try {
      bridge.postMessage(encode(message));
    } catch {
      /* the app went away: nothing to do */
    }
  };

  let lastRun: FillRun | null = null;
  let remembered: { runId: string; journal: UndoJournal; growth: FillRun['growth'] } | null = null;
  let lastScan: { count: number; iframes: number } | null = null;
  let obstacles: ObstacleWatcher | null = null;
  let handlers: ReturnType<typeof createFrameHandlers> | null = null;
  /** Top frame only: auto-advance reads the step and presses Next here. */
  let steps: StepHandlers | null = null;

  const iframeCount = () => Math.min(MAX_FRAMES, countChildFrames(doc));
  const scan = () => {
    try {
      const count = Math.min(MAX_SCAN_COUNT, scanDocument(doc, idFor).fillableCount);
      const iframes = iframeCount();
      if (lastScan && lastScan.count === count && lastScan.iframes === iframes) return;
      lastScan = { count, iframes };
      post({ v, kind: 'scan', count, iframes });
    } catch {
      /* a page we cannot scan must never break the page itself */
    }
  };

  async function handle(text: string): Promise<void> {
    const command = decodeAppCommand(text);
    if (!command) {
      const reqId = readableReqId(text);
      if (reqId) post({ v, kind: 'error', reqId, code: 'bad_payload' });
      return;
    }
    const h = handlers;
    if (!h) return;
    await run(h, command);
  }

  async function run(h: NonNullable<typeof handlers>, command: AppCommand): Promise<void> {
    switch (command.kind) {
      case 'needs': {
        let needs;
        try {
          needs = h.needs();
        } catch {
          needs = { fieldKeys: [], repeatSections: [], attachmentKeys: [] };
        }
        post({ v, kind: 'needs', reqId: command.reqId, needs });
        return;
      }
      case 'fill': {
        // The frame may have navigated since the app checked it: only its own origin may fill.
        if (command.origin !== globalThis.location?.origin) {
          post({ v, kind: 'error', reqId: command.reqId, code: 'wrong_origin' });
          return;
        }
        const sensitive = command.sensitiveFields ? { sensitiveFields: command.sensitiveFields } : {};
        try {
          if (command.only) {
            // 「这次填上」: one field, the rest left alone. The full fill's undo stays the one to go back to.
            const only = new Set(command.only);
            const excludedFieldIds = scanDocument(doc, idFor).contexts.map((c) => c.control.id).filter((id) => !only.has(id));
            const report = await h.fill({ resume: command.resume, files: command.files, filter: { excludedFieldIds }, ...sensitive });
            const fields = report.fields.filter((f) => only.has(f.fieldId));
            post({ v, kind: 'report', reqId: command.reqId, runId: command.runId, report: toWire({ ...report, fields, entries: [] }) });
            return;
          }
          const journal = createUndoJournal(doc);
          journal.snapshot();
          lastRun = null;
          const report = await h.fill({ resume: command.resume, files: command.files, ...sensitive });
          const finished = lastRun as FillRun | null;
          journal.afterFill(finished?.controls ?? new Map(), report.fields);
          remembered = { runId: command.runId, journal, growth: finished?.growth ?? [] };
          post({ v, kind: 'report', reqId: command.reqId, runId: command.runId, report: toWire(report) });
        } catch {
          post({ v, kind: 'error', reqId: command.reqId, code: 'fill_failed' });
        }
        return;
      }
      case 'focus': {
        let ok = false;
        try {
          ok = h.focus(command.fieldId);
        } catch {
          ok = false;
        }
        post({ v, kind: 'focused', reqId: command.reqId, ok });
        return;
      }
      case 'undo': {
        const last = remembered;
        if (!last || last.runId !== command.runId) {
          post({ v, kind: 'error', reqId: command.reqId, code: 'undo_failed' });
          return;
        }
        remembered = null;
        try {
          const { restored, manual } = last.journal.restore();
          clearHighlights();
          post({
            v,
            kind: 'undone',
            reqId: command.reqId,
            runId: command.runId,
            restored: restored.slice(0, MAX_REPORT_ROWS),
            manual: manual.slice(0, MAX_REPORT_ROWS),
            addedCards: Math.min(500, addedCards(last.growth)),
          });
        } catch {
          post({ v, kind: 'error', reqId: command.reqId, code: 'undo_failed' });
        }
        return;
      }
      case 'clear':
        clearHighlights();
        return;
      case 'step': {
        if (!steps) return;
        try {
          post({ v, kind: 'step', reqId: command.reqId, state: { ...steps.stepState(), title: cut(stepTitle(doc) ?? '', MAX_LABEL) || null } });
        } catch {
          /* no answer: the app reads that as a page it cannot read */
        }
        return;
      }
      case 'press': {
        if (!steps) return;
        let result: { pressed: boolean; reason?: (typeof PRESS_STOPS)[number] };
        try {
          const r = steps.pressNext();
          const reason = r.reason && (PRESS_STOPS as readonly string[]).includes(r.reason) ? (r.reason as (typeof PRESS_STOPS)[number]) : undefined;
          result = { pressed: r.pressed, ...(reason ? { reason } : {}) };
        } catch {
          result = { pressed: false };
        }
        post({ v, kind: 'pressed', reqId: command.reqId, ...result });
        return;
      }
    }
  }

  bridge.onmessage = (event) => {
    const data = event?.data;
    if (typeof data !== 'string') return;
    void handle(data).catch(() => undefined);
  };

  const ready = () => {
    registerAllDrivers();
    const watcher = createScanWatcher({ doc, scan, isBusy: () => handlers?.isBusy() ?? false });
    handlers = createFrameHandlers({
      doc,
      idFor,
      discardOwnWrites: () => watcher.discardOwnWrites(),
      onIdle: () => {
        watcher.schedule();
        obstacles?.schedule();
      },
      // Same as runFill, but keeps the last run's controls and card growth for undo.
      runFill: async (d, payload, opts) => {
        const result = await runFill(d, payload, opts);
        lastRun = result;
        return result;
      },
    });
    post({ v, kind: 'hello', iframes: iframeCount() });
    scan();
    watcher.start();
    if (win === win.top) {
      steps = createStepHandlers(doc, {
        adapterStep: () => resolveAdapter(doc)?.stepSignature?.(doc) ?? null,
        adapterNext: () => resolveAdapter(doc)?.nextButton,
      });
      try {
        obstacles = startObstacleWatcher(win, (report) => post({ v, kind: 'obstacles', ...report }));
      } catch {
        obstacles = null;
      }
    }
    win.addEventListener('pagehide', () => post({ v, kind: 'bye' }));
  };

  if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', ready, { once: true });
  else ready();
}

(() => {
  const g = globalThis as { rafBridge?: Partial<Bridge> };
  const bridge = g.rafBridge;
  if (!bridge || typeof bridge.postMessage !== 'function') return; // not our WebView
  const protocol = globalThis.location?.protocol;
  if (protocol !== 'http:' && protocol !== 'https:') return;
  if (typeof document === 'undefined' || typeof window === 'undefined') return;
  start(bridge as Bridge, document, window);
})();
