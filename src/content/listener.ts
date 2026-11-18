// `runtime.onMessage` listener of the content script (runs in every frame, next to the FAB's listener).
// Only commands from the background are handled: same extension id, no `sender.tab`. Everything
// else (including `scan:total` / `report:updated`, which belong to the FAB) is left alone: returning
// false without responding lets other listeners answer.
import { isFromExtension, isValidMessage, type Sender } from '../messaging';
import type { FrameHandlers } from './handlers';

export type ContentListener = (message: unknown, sender: Sender, sendResponse: (response?: unknown) => void) => boolean;

export function createContentListener(handlers: FrameHandlers): ContentListener {
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
        const { resume, files, presetId, recipes } = message;
        if (typeof resume !== 'object' || resume === null || typeof files !== 'object' || files === null) return false;
        Promise.resolve()
          .then(() =>
            handlers.preview({
              resume,
              files,
              ...(presetId ? { presetId } : {}),
              ...(Array.isArray(recipes) ? { recipes } : {}),
            }),
          )
          .then(sendResponse, () => sendResponse(undefined));
        return true;
      }
      case 'frame:fill': {
        const { resume, files, filter, presetId, recipes } = message;
        if (typeof resume !== 'object' || resume === null || typeof files !== 'object' || files === null) return false;
        handlers
          .fill({
            resume,
            files,
            ...(filter ? { filter } : {}),
            ...(presetId ? { presetId } : {}),
            ...(Array.isArray(recipes) ? { recipes } : {}),
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
      case 'frame:apply': {
        if (typeof message.fieldId !== 'string') return false;
        const request: { fieldId: string; text?: string; optionLabel?: string } = { fieldId: message.fieldId };
        if (typeof message.text === 'string') request.text = message.text;
        if (typeof message.optionLabel === 'string') request.optionLabel = message.optionLabel;
        handlers.apply(request).then(sendResponse, () => sendResponse(undefined));
        return true;
      }
      default:
        return false;
    }
  };
}
