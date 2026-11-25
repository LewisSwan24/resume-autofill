// Frame-side command handlers: fill, focus, apply. Keeps the controls of the last run.
import { registerAllDrivers } from '../drivers';
import { executeStep, type FillStep } from '../drivers/execute';
import type { FileData } from '../drivers/types';
import type { Control, FieldReport, FillFilter, FillReport, FramePreview } from '../engine/types';
import { applyHighlights, clearHighlights, focusField } from '../fill/highlight';
import { highlightRun, runFill, runPreview, type FillPayload, type FillRun, type RunFillOptions } from '../fill/runFill';
import { collectEvidence } from '../engine/evidence';
import { captureFieldFingerprint } from '../recipes';
import type { AnswerTemplates, Resume, SensitiveFieldMode, SiteRecipe, SiteRecipeFingerprint } from '../schema';
import type { MappingPresetId } from '../templates/presets';
import type { FrameNeeds } from '../engine/fieldDeps';
import { createFieldInspector, type InspectorTargetInfo } from './inspector';
import { buildApplyIntent } from './intent';
import { computeFrameNeeds } from './needs';

export interface FrameHandlerDeps {
  doc: Document;
  idFor: (el: HTMLElement) => string;
  /** Called right after our own highlight writes so the watcher can drop their mutation records. */
  discardOwnWrites?: () => void;
  /** Called when the frame goes idle again after a fill / apply (e.g. to schedule a rescan). */
  onIdle?: () => void;
  /** Called as a fill goes on: it is still at work (a form that adds many entries fills for a while). */
  onProgress?: () => void;
  /** Overrides for tests. */
  runFill?: (doc: Document, payload: FillPayload, opts: RunFillOptions) => Promise<FillRun>;
  executeStep?: typeof executeStep;
  computeNeeds?: (doc: Document, idFor: (el: HTMLElement) => string) => FrameNeeds;
  onInspectorHover?: (target: InspectorTargetInfo | null) => void;
  onInspectorPick?: (target: InspectorTargetInfo) => void;
}

export interface ApplyRequest {
  fieldId: string;
  text?: string;
  optionLabel?: string;
  /** Put back what the box held before the first text written to it from the side panel. */
  undo?: boolean;
}

/** What a text box holds now: its value, or the text of an editable element. */
const textIn = (el: HTMLElement): string =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : (el.textContent ?? '');

export interface FrameHandlers {
  /** What this frame could fill (scan only; touches neither the page nor any resume data). */
  needs(): FrameNeeds;
  preview(payload: { resume: Resume; files: Record<string, FileData>; presetId?: MappingPresetId; recipes?: SiteRecipe[]; sensitiveFields?: SensitiveFieldMode; answerTemplates?: AnswerTemplates }): FramePreview;
  fill(payload: { resume: Resume; files: Record<string, FileData>; filter?: FillFilter; presetId?: MappingPresetId; recipes?: SiteRecipe[]; sensitiveFields?: SensitiveFieldMode; answerTemplates?: AnswerTemplates }): Promise<FillReport>;
  focus(fieldId: string): boolean;
  apply(request: ApplyRequest): Promise<FieldReport>;
  captureFingerprint?(fieldId: string): SiteRecipeFingerprint | null;
  inspectorStart?(): void;
  inspectorStop?(): void;
  /** True while a fill / apply is running. */
  isBusy(): boolean;
}

export function createFrameHandlers(deps: FrameHandlerDeps): FrameHandlers {
  const run = deps.runFill ?? runFill;
  const exec = deps.executeStep ?? executeStep;
  let controls = new Map<string, Control>();
  let reports = new Map<string, FieldReport>();
  /** Per box written from the side panel: the text it held and its row before the first such write, for undo. */
  const before = new Map<string, { text: string; report: FieldReport | undefined }>();
  let busy = 0;
  let filling: Promise<FillReport> | null = null;

  const inspector = createFieldInspector({
    doc: deps.doc,
    onHover: (target) => {
      deps.onInspectorHover?.(target);
    },
    onPick: (target) => {
      deps.onInspectorPick?.(target);
    },
  });

  const discard = () => deps.discardOwnWrites?.();
  const enter = () => {
    busy++;
  };
  const leave = () => {
    if (--busy === 0) deps.onIdle?.();
  };

  /** Undo: the box gets its old text back and the row goes back to what it was; with nothing kept, nothing changes. */
  async function takeBack(fieldId: string, current: FieldReport | undefined): Promise<FieldReport> {
    const kept = before.get(fieldId);
    const control = controls.get(fieldId);
    const unchanged: FieldReport = current ?? { fieldId, label: '', fieldKey: null, section: null, outcome: 'no_control', confidence: 0 };
    if (!kept || !control || !control.el.isConnected) return unchanged;
    registerAllDrivers();
    await exec(
      { fieldId, fieldKey: current?.fieldKey ?? '', intent: { kind: 'text', text: kept.text }, confidence: 1, label: unchanged.label, section: unchanged.section },
      control,
      deps.doc,
    );
    before.delete(fieldId);
    const restored = kept.report ?? { ...unchanged, outcome: 'unmatched' as const };
    reports.set(fieldId, restored);
    applyHighlights([{ el: control.el, outcome: restored.outcome }]);
    discard();
    return restored;
  }

  async function doFill(payload: FillPayload, filter?: FillFilter): Promise<FillReport> {
    clearHighlights();
    before.clear();
    const result = await run(deps.doc, payload, {
      idFor: deps.idFor,
      ...(filter ? { filter } : {}),
      ...(deps.onProgress ? { onProgress: deps.onProgress } : {}),
    });
    controls = result.controls;
    reports = new Map(result.report.fields.map((f) => [f.fieldId, f]));
    highlightRun(result);
    discard();
    return result.report;
  }

  return {
    isBusy: () => busy > 0,

    needs: () => (deps.computeNeeds ?? computeFrameNeeds)(deps.doc, deps.idFor),

    preview: (payload) => runPreview(deps.doc, payload, { idFor: deps.idFor }),

    fill(payload) {
      // A second request while one is running joins it instead of driving the page twice.
      if (filling) return filling;
      enter();
      const { filter, ...rest } = payload;
      const current = doFill(rest, filter).finally(() => {
        filling = null;
        leave();
      });
      filling = current;
      return current;
    },

    focus(fieldId) {
      const control = controls.get(fieldId);
      if (!control || !control.el.isConnected) return false;
      focusField(control.el);
      return true;
    },

    async apply({ fieldId, text, optionLabel, undo }) {
      if (filling) await filling.catch(() => undefined);
      enter();
      try {
        const previous = reports.get(fieldId);
        if (undo) return await takeBack(fieldId, previous);
        const base: FieldReport = {
          fieldId,
          label: previous?.label ?? '',
          fieldKey: previous?.fieldKey ?? null,
          section: previous?.section ?? null,
          outcome: 'no_control',
          confidence: previous?.confidence ?? 0,
        };
        const control = controls.get(fieldId);
        const intent = buildApplyIntent({
          ...(text !== undefined ? { text } : {}),
          ...(optionLabel !== undefined ? { optionLabel } : {}),
        });
        if (!control || !control.el.isConnected) return base;
        if (!intent) return { ...base, outcome: 'action_failed' };

        registerAllDrivers();
        const step: FillStep = {
          fieldId,
          fieldKey: previous?.fieldKey ?? '',
          intent,
          confidence: previous?.confidence ?? 1,
          label: base.label,
          section: base.section,
        };
        if (previous?.source !== undefined) step.source = previous.source;

        if (text !== undefined && !before.has(fieldId)) before.set(fieldId, { text: textIn(control.el), report: previous });
        const executed = await exec(step, control, deps.doc);
        // executeStep reports what it was given; restore what the scan knew about the field.
        const updated: FieldReport = {
          ...executed,
          label: base.label,
          fieldKey: base.fieldKey,
          section: base.section,
          confidence: base.confidence || executed.confidence,
        };
        if (previous?.source !== undefined) updated.source = previous.source;
        // A written draft stays marked as one, so the side panel can offer to take it back.
        if (previous?.note === 'draft') updated.note = 'draft';
        reports.set(fieldId, updated);
        applyHighlights([{ el: control.el, outcome: updated.outcome }]);
        discard();
        return updated;
      } finally {
        leave();
      }
    },

    captureFingerprint(fieldId) {
      const control = controls.get(fieldId);
      if (!control || !control.el.isConnected) return null;
      return captureFieldFingerprint(control, collectEvidence(control));
    },

    inspectorStart() {
      inspector.start();
    },

    inspectorStop() {
      inspector.stop();
    },
  };
}
