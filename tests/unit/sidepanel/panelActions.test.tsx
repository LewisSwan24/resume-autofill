// The side panel's own fills: "use as" a field it may be (one box by that key), "fill this one" for a box left alone,
// and "retry" for the boxes that failed or were not recognised. An option candidate is still picked as an option.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/sidepanel/App';
import type { FieldReport, FillReport } from '../../../src/engine/types';
import { countOutcomes } from '../../../src/fill/report';
import { setLanguage } from '../../../src/i18n';
import type { UiToBg } from '../../../src/messaging';
import { createSampleProfile } from '../../../src/schema';
import { saveProfile } from '../../../src/storage';

const TAB_ID = 31;
const base = { frameId: 0, section: null, confidence: 0.6 } as const;
const keyed: FieldReport = {
  ...base, fieldId: 'k1', label: 'Contact', fieldKey: 'contact.email', outcome: 'needs_review',
  candidates: [{ label: 'Email', fieldKey: 'contact.email' }, { label: 'Phone', fieldKey: 'contact.phone' }],
};
const optioned: FieldReport = {
  ...base, fieldId: 'o1', label: 'Degree', fieldKey: 'education.degree', outcome: 'no_option', candidates: [{ label: 'Bachelor' }],
};
const kept: FieldReport = {
  ...base, fieldId: 'h1', label: 'City', fieldKey: 'contact.addressCity', outcome: 'needs_review', note: 'answer_held', observed: 'Elsewhere',
};
const failed: FieldReport = { ...base, fieldId: 'f1', label: 'Start date', fieldKey: 'education.startDate', outcome: 'action_failed' };

beforeEach(() => {
  fakeBrowser.reset();
  setLanguage('en');
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

async function open(fields: FieldReport[]) {
  const profile = createSampleProfile();
  profile.activeResumeId = 'sample-en';
  Object.assign(profile.settings, { uiLanguage: 'en', aiLayerMode: 'bm25_only' });
  await saveProfile(profile);
  const report: FillReport = { url: 'https://careers.example.com/apply', startedAt: 1, finishedAt: 2, counts: countOutcomes(fields), fields };
  await fakeBrowser.storage.session.set({ [`report:${TAB_ID}`]: report });
  window.history.replaceState({}, '', `/sidepanel.html?tabId=${TAB_ID}`);
  const sent: UiToBg[] = [];
  fakeBrowser.runtime.onMessage.addListener(((msg: UiToBg, _s: unknown, sendResponse: (r: unknown) => void) => {
    sent.push(msg);
    if (msg.type === 'field:fill') {
      const row = fields.find((f) => f.fieldId === msg.fieldId)!;
      sendResponse({ ...row, fieldKey: msg.fieldKey, outcome: 'filled', note: undefined });
      return true;
    }
    if (msg.type === 'field:apply') {
      sendResponse({ ...optioned, outcome: 'filled', value: msg.optionLabel });
      return true;
    }
    if (msg.type === 'fill:retry') {
      sendResponse({ ok: true });
      return true;
    }
    return undefined;
  }) as never);
  render(<App />);
  await screen.findByText(fields[0]!.label);
  return sent;
}

const expand = (label: string) => fireEvent.click(screen.getByText(label));

describe('side panel fills of its own', () => {
  it('“use as” a candidate field fills the box by that key; an option candidate is still picked', async () => {
    const sent = await open([keyed, optioned]);
    expand('Contact');
    fireEvent.click(screen.getByRole('button', { name: 'Use as Phone' }));
    await waitFor(() => expect(sent).toContainEqual({ type: 'field:fill', tabId: TAB_ID, frameId: 0, fieldId: 'k1', fieldKey: 'contact.phone' }));
    expand('Degree');
    fireEvent.click(screen.getByRole('button', { name: 'Use Bachelor' }));
    await waitFor(() => expect(sent).toContainEqual(expect.objectContaining({ type: 'field:apply', fieldId: 'o1', optionLabel: 'Bachelor' })));
    expect(sent.filter((m) => m.type === 'field:apply' && 'optionLabel' in m && m.optionLabel === 'Phone')).toEqual([]);
  });

  it('“fill this one” writes the resume’s answer over a box that held its own', async () => {
    const sent = await open([kept]);
    expand('City');
    fireEvent.click(screen.getByRole('button', { name: 'Fill this one' }));
    await waitFor(() => expect(sent).toContainEqual({ type: 'field:fill', tabId: TAB_ID, frameId: 0, fieldId: 'h1', fieldKey: 'contact.addressCity' }));
  });

  it('offers a retry of the failed and unrecognised boxes, and only when there are some', async () => {
    const sent = await open([failed, kept]);
    fireEvent.click(screen.getByRole('button', { name: 'Retry (1)' }));
    await waitFor(() => expect(sent).toContainEqual({ type: 'fill:retry', tabId: TAB_ID }));
    cleanup();
    await open([kept]);
    expect(screen.queryByRole('button', { name: /^Retry/ })).toBeNull();
  });

  // A page that holds an earlier resume (a site's own resume, being updated): every box that kept its answer takes the
  // resume's in one press, and the button goes once none is left.
  it('writes the resume over every box that kept its own answer, in one press, and only when there are some', async () => {
    const town: FieldReport = { ...kept, fieldId: 'h2', label: 'Town', fieldKey: 'basics.currentLocation', observed: 'Old town' };
    const sent = await open([kept, town, failed]);
    fireEvent.click(screen.getByRole('button', { name: 'Replace with resume (2)' }));
    await waitFor(() => {
      expect(sent).toContainEqual({ type: 'field:fill', tabId: TAB_ID, frameId: 0, fieldId: 'h1', fieldKey: 'contact.addressCity' });
      expect(sent).toContainEqual({ type: 'field:fill', tabId: TAB_ID, frameId: 0, fieldId: 'h2', fieldKey: 'basics.currentLocation' });
    });
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Replace with resume/ })).toBeNull());
    expect(sent.filter((m) => m.type === 'field:fill' && m.fieldId === 'f1')).toEqual([]);
    cleanup();
    await open([failed]);
    expect(screen.queryByRole('button', { name: /^Replace with resume/ })).toBeNull();
  });
});
