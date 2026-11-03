// Messages the side panel sends about a single field: focus it, or apply a text / option to it.
import { useCallback } from 'react';
import type { FieldReport, Outcome } from '../../src/engine/types';
import { sendToBackground } from '../../src/messaging';

export type ApplyInput = { text: string } | { optionLabel: string };
/** ok: false carries the outcome the page reported, or an error message; neither = nobody answered. */
export type ApplyResult = { ok: true; field: FieldReport } | { ok: false; outcome?: Outcome; message?: string };

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

export function useFieldActions(tabId: number | null, onUpdated: (field: FieldReport) => void) {
  const focus = useCallback(
    (field: FieldReport) => {
      if (tabId === null) return;
      sendToBackground({ type: 'field:focus', tabId, frameId: field.frameId ?? 0, fieldId: field.fieldId }).catch(() => undefined);
    },
    [tabId],
  );

  const apply = useCallback(
    async (field: FieldReport, input: ApplyInput): Promise<ApplyResult> => {
      if (tabId === null) return { ok: false };
      try {
        const result = await sendToBackground({
          type: 'field:apply',
          tabId,
          frameId: field.frameId ?? 0,
          fieldId: field.fieldId,
          ...input,
        });
        // No response means nobody handled the message (e.g. the page was closed).
        if (!result || typeof result !== 'object') return { ok: false };
        const updated: FieldReport = { ...result, frameId: result.frameId ?? field.frameId };
        onUpdated(updated);
        return updated.outcome === 'filled' ? { ok: true, field: updated } : { ok: false, outcome: updated.outcome };
      } catch (error) {
        return { ok: false, message: messageOf(error) };
      }
    },
    [tabId, onUpdated],
  );

  return { focus, apply };
}
