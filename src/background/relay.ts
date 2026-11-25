// Relay of single-field commands from the FAB / side panel to the frame that owns the control.
import type { FieldReport } from '../engine/types';
import type { SiteRecipeFingerprint } from '../schema';
import { sendToFrame } from '../messaging';
import { FRAME_TIMEOUT_MS, withTimeout } from './frames';
import { isFieldReport, isSectionRow, sameField } from './merge';
import { patchStoredField } from './tabState';

export interface RelayDeps {
  send?: typeof sendToFrame;
  timeoutMs?: number;
}

/** `field:focus` → `frame:focus`. Rows without a control (`section:*`) are ignored. */
export async function relayFocus(
  tabId: number,
  frameId: number,
  fieldId: string,
  deps: RelayDeps = {},
): Promise<void> {
  if (isSectionRow(fieldId)) return;
  const send = deps.send ?? sendToFrame;
  await withTimeout(send(tabId, frameId, { type: 'frame:focus', fieldId }), deps.timeoutMs ?? FRAME_TIMEOUT_MS);
}

export interface ApplyInput {
  tabId: number;
  frameId: number;
  fieldId: string;
  text?: string;
  optionLabel?: string;
  /** Put back what the box held before the side panel first wrote to it. */
  undo?: boolean;
}

/**
 * `field:apply` → `frame:apply`; the stored report row is patched with the answer. Resolves to the
 * updated row (with `frameId`), or `null` when the row has no control or the frame did not answer
 * with a field report.
 */
export async function relayApply(input: ApplyInput, deps: RelayDeps = {}): Promise<FieldReport | null> {
  const { tabId, frameId, fieldId } = input;
  if (isSectionRow(fieldId)) return null;
  const send = deps.send ?? sendToFrame;
  const msg: { type: 'frame:apply'; fieldId: string; text?: string; optionLabel?: string; undo?: boolean } = {
    type: 'frame:apply',
    fieldId,
  };
  if (input.text !== undefined) msg.text = input.text;
  if (input.optionLabel !== undefined) msg.optionLabel = input.optionLabel;
  if (input.undo) msg.undo = true;

  const answer: unknown = await withTimeout(send(tabId, frameId, msg), deps.timeoutMs ?? FRAME_TIMEOUT_MS);
  if (!isFieldReport(answer)) return null;
  const field: FieldReport = { ...answer, fieldId, frameId };
  const patched = await patchStoredField(tabId, frameId, field);
  // Prefer the stored row: it keeps the label / key / section the page may have lost.
  return patched?.fields.find((f) => sameField(f, frameId, fieldId)) ?? field;
}

export async function relayCaptureFingerprint(
  tabId: number,
  frameId: number,
  fieldId: string,
  deps: RelayDeps = {},
): Promise<SiteRecipeFingerprint | null> {
  if (isSectionRow(fieldId)) return null;
  const send = deps.send ?? sendToFrame;
  const answer = await withTimeout(
    send(tabId, frameId, { type: 'frame:captureFingerprint', fieldId }),
    deps.timeoutMs ?? FRAME_TIMEOUT_MS,
  );
  return answer && typeof answer === 'object' ? (answer as SiteRecipeFingerprint) : null;
}
