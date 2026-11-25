// A drafted long-text answer in the side panel: an editable box, written only on "Fill in", taken back with "Undo",
// and a rewrite by the local AI only when the setting is on.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/sidepanel/App';
import type { FieldReport, FillReport } from '../../../src/engine/types';
import { setLanguage } from '../../../src/i18n';
import type { UiToBg } from '../../../src/messaging';
import { createSampleProfile, type Settings } from '../../../src/schema';
import { saveProfile } from '../../../src/storage';

const TAB_ID = 23;
const DRAFT = 'I am applying for the Data Analyst role at Example Group.';
const row: FieldReport = {
  fieldId: 'cl', frameId: 0, label: 'Cover letter', fieldKey: 'answers.coverLetter', section: 'selfIntro',
  outcome: 'needs_review', confidence: 0.9, note: 'draft', value: DRAFT, source: 'template.coverLetter',
};

beforeEach(() => {
  fakeBrowser.reset();
  setLanguage('en');
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  cleanup();
});

async function open(settings: Partial<Settings> = {}) {
  const profile = createSampleProfile();
  profile.activeResumeId = 'sample-en';
  Object.assign(profile.settings, { uiLanguage: 'en', aiLayerMode: 'bm25_only' }, settings);
  await saveProfile(profile);
  const report: FillReport = {
    url: 'https://careers.example.com/apply', startedAt: 1, finishedAt: 2,
    counts: { filled: 0, needs_review: 1, unmatched: 0, no_data: 0, no_control: 0, no_option: 0, action_failed: 0 },
    fields: [row],
  };
  await fakeBrowser.storage.session.set({ [`report:${TAB_ID}`]: report });
  window.history.replaceState({}, '', `/sidepanel.html?tabId=${TAB_ID}`);
  const sent: UiToBg[] = [];
  fakeBrowser.runtime.onMessage.addListener(((msg: UiToBg, _s: unknown, sendResponse: (r: unknown) => void) => {
    sent.push(msg);
    if (msg.type !== 'field:apply') return undefined;
    sendResponse(msg.undo ? row : { ...row, outcome: 'filled', value: msg.text, observed: msg.text });
    return true;
  }) as never);
  render(<App />);
  await screen.findByText('Cover letter');
  return sent;
}

describe('the draft box', () => {
  it('shows the draft in an editable box and writes nothing until "Fill in"', async () => {
    const sent = await open();
    const box = screen.getByRole('textbox', { name: /Cover letter/ }) as HTMLTextAreaElement;
    expect(box.tagName).toBe('TEXTAREA');
    expect(box.value).toBe(DRAFT);
    expect(screen.getByText(/drafted from your resume/i)).toBeTruthy();
    expect(sent).toHaveLength(0);

    fireEvent.change(box, { target: { value: `${DRAFT} Edited.` } });
    fireEvent.click(screen.getByRole('button', { name: 'Fill in' }));
    await waitFor(() => expect(sent.some((m) => m.type === 'field:apply' && m.text === `${DRAFT} Edited.`)).toBe(true));
  });

  it('takes a written draft back with "Undo"', async () => {
    const sent = await open();
    fireEvent.click(screen.getByRole('button', { name: 'Fill in' }));
    const undo = await screen.findByRole('button', { name: 'Undo' });
    fireEvent.click(undo);
    await waitFor(() => expect(sent.some((m) => m.type === 'field:apply' && m.undo === true)).toBe(true));
    await waitFor(() => expect(screen.queryByRole('button', { name: 'Undo' })).toBeNull());
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('offers a rewrite by the local AI only when the setting is on', async () => {
    await open();
    expect(screen.queryByRole('button', { name: 'Rewrite with AI' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'AI draft suggestion' })).toBeNull();
    cleanup();
    fakeBrowser.reset();
    await open({ longTextAiRewrite: true });
    expect(screen.getByRole('button', { name: 'Rewrite with AI' })).toBeTruthy();
  });
});
