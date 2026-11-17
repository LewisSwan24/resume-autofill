import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/sidepanel/App';
import type { FillReport } from '../../../src/engine/types';
import { setLanguage } from '../../../src/i18n';
import type { UiToBg } from '../../../src/messaging';
import { createSampleProfile } from '../../../src/schema';
import { loadProfile, saveProfile } from '../../../src/storage';

const TAB_ID = 19;

beforeEach(() => {
  fakeBrowser.reset();
  setLanguage('en');
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

describe('Side panel – layered AI draft suggestions & customAnswers self-learning loop', () => {
  it('shows local BM25 match without mutating DOM, drafts via Ollama on button click, and saves to customAnswers on apply', async () => {
    const profile = createSampleProfile();
    profile.activeResumeId = 'sample-en';
    profile.settings.uiLanguage = 'en';
    profile.settings.aiLayerMode = 'ollama';
    profile.settings.ollamaEnabled = true;
    profile.resumes[1]!.customAnswers = [
      { question: 'What is your proudest backend project?', answer: 'Built distributed queue handling 50k req/s' },
    ];
    await saveProfile(profile);

    const report: FillReport = {
      url: 'https://careers.example.com/apply',
      startedAt: 1,
      finishedAt: 2,
      counts: { filled: 0, needs_review: 0, unmatched: 1, no_data: 0, no_control: 0, no_option: 0, action_failed: 0 },
      fields: [
        {
          fieldId: 'q1',
          frameId: 0,
          label: 'Tell us about your proudest backend project',
          fieldKey: null,
          section: 'other',
          outcome: 'unmatched',
          confidence: 0.2,
        },
      ],
    };
    await fakeBrowser.storage.session.set({ [`report:${TAB_ID}`]: report });
    window.history.replaceState({}, '', `/sidepanel.html?tabId=${TAB_ID}`);

    const sent: UiToBg[] = [];
    fakeBrowser.runtime.onMessage.addListener(((msg: UiToBg, _sender: unknown, sendResponse: (r: unknown) => void) => {
      sent.push(msg);
      if (msg.type === 'field:apply') {
        sendResponse({ ...report.fields[0]!, outcome: 'filled', observed: msg.text });
        return true;
      }
      return undefined;
    }) as never);

    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ response: 'Ollama refined project answer' }), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    render(<App />);
    await screen.findByText('Tell us about your proudest backend project');

    // Before clicking AI draft button, Ollama fetch must NOT be called automatically and DOM must not be filled.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(sent).toHaveLength(0);

    // Local BM25 memory suggestion renders synchronously
    expect(screen.getByText('Built distributed queue handling 50k req/s')).toBeTruthy();

    // Click on-demand "AI draft suggestion"
    fireEvent.click(screen.getByRole('button', { name: 'AI draft suggestion' }));
    await screen.findByText('Ollama refined project answer');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Put draft into manual editor (still zero apply sent)
    const useButtons = screen.getAllByRole('button', { name: 'Use in editor' });
    fireEvent.click(useButtons[useButtons.length - 1]!);
    expect(sent).toHaveLength(0);

    // Tick "Save to resume Q&A library (customAnswers)" and click "Save"
    fireEvent.click(screen.getByLabelText(/Save to resume Q&A library/));
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(async () => {
      const updated = await loadProfile();
      const active = updated.resumes.find((r) => r.id === 'sample-en')!;
      expect(active.customAnswers.some((qa) => qa.question === 'Tell us about your proudest backend project' && qa.answer === 'Ollama refined project answer')).toBe(true);
    });
    expect(sent.some((m) => m.type === 'field:apply' && m.text === 'Ollama refined project answer')).toBe(true);
  });
});
