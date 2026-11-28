// The one-line edit box under a report row: an edit the applicant types is what "Save" writes.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createRoot } from 'react-dom/client';
import { ReportList } from '../../../entrypoints/sidepanel/ReportList';
import type { ApplyInput, ApplyResult } from '../../../entrypoints/sidepanel/useFieldActions';
import type { FieldReport } from '../../../src/engine/types';
import { setLanguage } from '../../../src/i18n';

const row: FieldReport = {
  fieldId: 'city', frameId: 0, label: 'City', fieldKey: 'basics.city', section: 'basics',
  outcome: 'needs_review', confidence: 0.6, value: 'Springfield', source: 'basics.city',
};

beforeEach(() => setLanguage('en'));
afterEach(() => vi.restoreAllMocks());

describe('the edit box of a report row', () => {
  it('keeps an edit typed the moment the row appears, before its first effects have run', async () => {
    // The list reaches the screen from a storage read, outside any act(): React commits the row in one task and runs
    // its effects in a later one. An edit landing between the two must survive them.
    const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };
    const prevAct = env.IS_REACT_ACT_ENVIRONMENT;
    env.IS_REACT_ACT_ENVIRONMENT = false;
    const host = document.body.appendChild(document.createElement('div'));
    const root = createRoot(host);
    const onApply = vi.fn(async (field: FieldReport, _input: ApplyInput): Promise<ApplyResult> => ({ ok: true, field }));
    try {
      const edited = new Promise<HTMLInputElement>((resolve) => {
        const watch = new MutationObserver(() => {
          const box = host.querySelector<HTMLInputElement>('input[type="text"]');
          if (!box) return;
          watch.disconnect();
          // Runs as a microtask right after the commit, so the row's effects are still pending.
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(box, 'Shelbyville');
          box.dispatchEvent(new Event('input', { bubbles: true }));
          resolve(box);
        });
        watch.observe(host, { childList: true, subtree: true });
      });
      root.render(<ReportList fields={[row]} onFocus={() => undefined} onApply={onApply} />);
      const box = await edited;
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(box.value).toBe('Shelbyville');
      box.form!.requestSubmit();
      expect(onApply).toHaveBeenCalledWith(expect.objectContaining({ fieldId: 'city' }), { text: 'Shelbyville' });
    } finally {
      root.unmount();
      host.remove();
      env.IS_REACT_ACT_ENVIRONMENT = prevAct;
    }
  });
});
