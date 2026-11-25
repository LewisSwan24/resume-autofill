// `runtime.onMessage` listener of the content script (runs in every frame, next to the FAB's listener).
// Only commands from the background are handled: same extension id, no `sender.tab`. Everything
// else (including `scan:total` / `report:updated`, which belong to the FAB) is left alone: returning
// false without responding lets other listeners answer.
import { isAttachmentKey } from '../engine/fieldDeps';
import { isFromExtension, isValidMessage, type Sender } from '../messaging';
import { getFieldKeyDef, type FieldKey } from '../schema/fieldKeys';
import type { FrameHandlers } from './handlers';
import type { StepHandlers } from './steps';

export type ContentListener = (message: unknown, sender: Sender, sendResponse: (response?: unknown) => void) => boolean;

/** `steps` only in the top frame: it alone reports the step and presses Next (auto-advance). */
export function createContentListener(handlers: FrameHandlers, steps?: StepHandlers): ContentListener {
  return (message, sender, sendResponse) => {
    if (!isFromExtension(sender) || sender.tab != null || !isValidMessage(message)) return false;

    switch (message.type) {
      case 'frame:needs': {
        // Scan only: no resume data is involved, nothing is filled.
        Promise.resolve()
          .then(() => handlers.needs())
          .then(sendResponse, () => sendResponse(undefined));
        return true;
      }
      case 'frame:preview': {
        const { resume, files, presetId, recipes, sensitiveFields, answerTemplates } = message;
        if (typeof resume !== 'object' || resume === null || typeof files !== 'object' || files === null) return false;
        Promise.resolve()
          .then(() =>
            handlers.preview({
              resume,
              files,
              ...(presetId ? { presetId } : {}),
              ...(Array.isArray(recipes) ? { recipes } : {}),
              ...(sensitiveFields === 'fill' ? { sensitiveFields } : {}),
              ...(answerTemplates && typeof answerTemplates === 'object' ? { answerTemplates } : {}),
            }),
          )
          .then(sendResponse, () => sendResponse(undefined));
        return true;
      }
      case 'frame:fill': {
        const { resume, files, filter, presetId, recipes, sensitiveFields, answerTemplates } = message;
        if (typeof resume !== 'object' || resume === null || typeof files !== 'object' || files === null) return false;
        handlers
          .fill({
            resume,
            files,
            ...(filter ? { filter } : {}),
            ...(presetId ? { presetId } : {}),
            ...(Array.isArray(recipes) ? { recipes } : {}),
            ...(sensitiveFields === 'fill' ? { sensitiveFields } : {}),
            ...(answerTemplates && typeof answerTemplates === 'object' ? { answerTemplates } : {}),
          })
          .then(sendResponse, () => sendResponse(undefined));
        return true;
      }
      case 'frame:fillOne': {
        const { fieldId, fieldKey, resume, files, answerTemplates } = message;
        if (typeof fieldId !== 'string' || typeof fieldKey !== 'string') return false;
        if (!getFieldKeyDef(fieldKey) && !isAttachmentKey(fieldKey)) return false;
        if (typeof resume !== 'object' || resume === null || typeof files !== 'object' || files === null) return false;
        handlers
          .fillOne({
            fieldId,
            fieldKey: fieldKey as FieldKey,
            resume,
            files,
            ...(answerTemplates && typeof answerTemplates === 'object' ? { answerTemplates } : {}),
          })
          .then(sendResponse, () => sendResponse(undefined));
        return true;
      }
      case 'frame:focus': {
        if (typeof message.fieldId !== 'string') return false;
        handlers.focus(message.fieldId);
        return false;
      }
      case 'frame:captureFingerprint': {
        if (typeof message.fieldId !== 'string') return false;
        Promise.resolve()
          .then(() => handlers.captureFingerprint?.(message.fieldId) ?? null)
          .then(sendResponse, () => sendResponse(null));
        return true;
      }
      case 'frame:inspectorStart': {
        handlers.inspectorStart?.();
        return false;
      }
      case 'frame:inspectorStop': {
        handlers.inspectorStop?.();
        return false;
      }
      case 'frame:apply': {
        if (typeof message.fieldId !== 'string') return false;
        const request: { fieldId: string; text?: string; optionLabel?: string; undo?: boolean } = { fieldId: message.fieldId };
        if (typeof message.text === 'string') request.text = message.text;
        if (typeof message.optionLabel === 'string') request.optionLabel = message.optionLabel;
        if (message.undo === true) request.undo = true;
        handlers.apply(request).then(sendResponse, () => sendResponse(undefined));
        return true;
      }
      case 'frame:stepState': {
        if (!steps) return false;
        sendResponse(steps.stepState());
        return false;
      }
      case 'frame:pressNext': {
        if (!steps) return false;
        sendResponse(steps.pressNext());
        return false;
      }
      default:
        return false;
    }
  };
}
