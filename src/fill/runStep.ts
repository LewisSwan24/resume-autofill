import { executeStep, intentDisplay } from '../drivers/execute';
import type { FillStep } from '../engine/plan';
import type { Control, FieldReport } from '../engine/types';

/** One step of a plan. Never throws: a step that fails becomes a row in the report. */
export async function runStep(step: FillStep, controls: ReadonlyMap<string, Control>, doc: Document): Promise<FieldReport> {
  const control = controls.get(step.fieldId);
  if (!control) {
    return {
      fieldId: step.fieldId,
      label: step.label,
      fieldKey: step.fieldKey,
      section: step.section ?? null,
      outcome: 'no_control',
      confidence: step.confidence,
    };
  }
  try {
    return await executeStep(step, control, doc);
  } catch (error) {
    // executeStep reports its own failures; this is the last line of defence for the rest of the run.
    console.warn('[runFill] step failed unexpectedly', step.fieldId, error);
    return {
      fieldId: step.fieldId,
      label: step.label,
      fieldKey: step.fieldKey,
      section: step.section ?? null,
      outcome: 'action_failed',
      confidence: step.confidence,
      value: intentDisplay(step.intent),
      ...(step.source !== undefined ? { source: step.source } : {}),
    };
  }
}
