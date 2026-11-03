// Frame-side command handlers: fill, focus, apply. Keeps the controls of the last run.
import { registerAllDrivers } from '../drivers';
import { executeStep, type FillStep } from '../drivers/execute';
import type { FileData } from '../drivers/types';
import type { Control, FieldReport, FillReport } from '../engine/types';
import { applyHighlights, clearHighlights, focusField } from '../fill/highlight';
import { highlightRun, runFill, type FillPayload, type FillRun } from '../fill/runFill';
import type { Resume } from '../schema';
import { buildApplyIntent } from './intent';

export interface FrameHandlerDeps {
  doc: Document;
  idFor: (el: HTMLElement) => string;
  /** Called right after our own highlight writes so the watcher can drop their mutation records. */
  discardOwnWrites?: () => void;
  /** Called when the frame goes idle again after a fill / apply (e.g. to schedule a rescan). */
  onIdle?: () => void;
  /** Overrides for tests. */
  runFill?: (doc: Document, payload: FillPayload, opts: { idFor: (el: HTMLElement) => string }) => Promise<FillRun>;
  executeStep?: typeof executeStep;
}

export interface ApplyRequest {
  fieldId: string;
  text?: string;
  optionLabel?: string;
}

export interface FrameHandlers {
  fill(payload: { resume: Resume; files: Record<string, FileData> }): Promise<FillReport>;
  focus(fieldId: string): boolean;
  apply(request: ApplyRequest): Promise<FieldReport>;
  /** True while a fill / apply is running. */
  isBusy(): boolean;
}

export function createFrameHandlers(deps: FrameHandlerDeps): FrameHandlers {
  const run = deps.runFill ?? runFill;
  const exec = deps.executeStep ?? executeStep;
  let controls = new Map<string, Control>();
  let reports = new Map<string, FieldReport>();
  let busy = 0;
  let filling: Promise<FillReport> | null = null;

  const discard = () => deps.discardOwnWrites?.();
  const enter = () => {
    busy++;
  };
  const leave = () => {
    if (--busy === 0) deps.onIdle?.();
  };

  async function doFill(payload: FillPayload): Promise<FillReport> {
    clearHighlights();
    const result = await run(deps.doc, payload, { idFor: deps.idFor });
    controls = result.controls;
    reports = new Map(result.report.fields.map((f) => [f.fieldId, f]));
    highlightRun(result);
    discard();
    return result.report;
  }

  return {
    isBusy: () => busy > 0,

    fill(payload) {
      // A second request while one is running joins it instead of driving the page twice.
      if (filling) return filling;
      enter();
      const current = doFill(payload).finally(() => {
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

    async apply({ fieldId, text, optionLabel }) {
      if (filling) await filling.catch(() => undefined);
      enter();
      try {
        const previous = reports.get(fieldId);
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
        reports.set(fieldId, updated);
        applyHighlights([{ el: control.el, outcome: updated.outcome }]);
        discard();
        return updated;
      } finally {
        leave();
      }
    },
  };
}
