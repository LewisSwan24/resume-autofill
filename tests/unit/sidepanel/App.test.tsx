import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/sidepanel/App';
import type { FieldReport, FillReport, Outcome } from '../../../src/engine/types';
import { setLanguage } from '../../../src/i18n';
import type { UiToBg } from '../../../src/messaging';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../src/schema';
import { loadProfile, saveProfile } from '../../../src/storage';

const WAIT = { timeout: 4000 };
const TAB_ID = 7;

const makeProfile = (uiLanguage: 'zh' | 'en' = 'en'): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    resumes: [
      ResumeSchema.parse({ id: 'r1', title: 'Main', locale: 'zh-CN' }),
      ResumeSchema.parse({ id: 'r2', title: 'English CV', locale: 'en-AU' }),
    ],
    activeResumeId: 'r1',
    settings: { uiLanguage },
  });

const field = (fieldId: string, outcome: Outcome, extra: Partial<FieldReport> = {}): FieldReport => ({
  fieldId,
  frameId: 0,
  label: `Label ${fieldId}`,
  fieldKey: null,
  section: null,
  outcome,
  confidence: 0.5,
  ...extra,
});

const makeReport = (fields: FieldReport[]): FillReport => {
  const counts = { filled: 0, needs_review: 0, unmatched: 0, no_data: 0, no_control: 0, no_option: 0, action_failed: 0 };
  for (const f of fields) counts[f.outcome] += 1;
  return { url: 'https://jobs.test/apply', startedAt: 1, finishedAt: 2, fields, counts };
};

const FIELDS = [
  field('c1', 'filled', { label: 'Email', value: 'a@b.test', source: 'basics.email', confidence: 0.92 }),
  field('c2', 'needs_review', {
    label: 'Degree',
    confidence: 0.6,
    candidates: [{ label: 'Bachelor' }, { label: 'Master' }],
  }),
  field('c3', 'unmatched', { label: 'Mystery', confidence: 0.2 }),
  field('c4', 'no_data', { label: 'Fax', frameId: 2 }),
];

const storeReport = (report: FillReport, tabId = TAB_ID) => fakeBrowser.storage.session.set({ [`report:${tabId}`]: report });

/** Collect messages a (fake) background would receive; answer `field:apply` with the given report. */
function listenAsBackground(respond?: (msg: UiToBg) => unknown) {
  const received: UiToBg[] = [];
  fakeBrowser.runtime.onMessage.addListener(((msg: UiToBg, _sender: unknown, sendResponse: (r: unknown) => void) => {
    if (msg.type !== 'field:apply' && msg.type !== 'field:focus') return undefined;
    received.push(msg);
    sendResponse(respond?.(msg));
    return true;
  }) as never);
  return received;
}

async function renderPanel(options: { profile?: Profile; report?: FillReport | null; tabId?: number } = {}) {
  const tabId = options.tabId ?? TAB_ID;
  window.history.replaceState({}, '', `/sidepanel.html?tabId=${tabId}`);
  await saveProfile(options.profile ?? makeProfile());
  if (options.report !== null) await storeReport(options.report ?? makeReport(FIELDS), tabId);
  return render(<App />);
}

const rowOf = (label: string) => screen.getByText(label).closest('tr') as HTMLTableRowElement;

beforeEach(() => {
  fakeBrowser.reset();
  setLanguage('en');
});
afterEach(() => {
  cleanup();
  setLanguage('en');
  window.history.replaceState({}, '', '/');
});

describe('Side panel – report table', () => {
  it('renders the five columns and one row per field, most urgent first', async () => {
    await renderPanel();
    await screen.findByText('Email');
    const headers = screen.getAllByRole('columnheader').map((h) => h.textContent);
    expect(headers).toEqual(['Field', 'Value', 'Confidence', 'Status']);

    const labels = [...document.querySelectorAll('.raf-cell-label')].map((c) => c.textContent);
    // severity: needs_review → unmatched → no_data → filled
    expect(labels).toEqual(['Degree', 'Mystery', 'Fax', 'Email']);

    const email = rowOf('Email');
    expect(within(email).getByText('a@b.test')).toBeTruthy();
    expect(within(email).getByText('basics.email')).toBeTruthy();
    expect(within(email).getByText('92%')).toBeTruthy();
    expect(email.querySelector('.raf-chip-success')?.textContent).toBe('Filled');
    expect(rowOf('Degree').querySelector('.raf-chip-warning')?.textContent).toBe('Needs review');
    expect(rowOf('Mystery').querySelector('.raf-chip-danger')?.textContent).toBe('Unmatched');
    expect(rowOf('Fax').querySelector('.raf-chip-muted')?.textContent).toBe('No data');
    expect(screen.getByText('4 fields, 1 filled')).toBeTruthy();
  });

  it('shows the empty state when the tab has no report', async () => {
    await renderPanel({ report: null });
    await screen.findByText(/Open an application page/);
    expect(screen.queryByRole('table')).toBeNull();
  });

  it('renders the Chinese empty state and headers when the UI language is zh', async () => {
    await renderPanel({ profile: makeProfile('zh'), report: null });
    await screen.findByText('打开网申页面后点击悬浮按钮开始填写');
    cleanup();
    await renderPanel({ profile: makeProfile('zh') });
    await screen.findByText('Email');
    expect(screen.getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['字段', '值', '置信度', '状态']);
  });

  it('filters by outcome chips', async () => {
    await renderPanel();
    await screen.findByText('Email');
    const filters = screen.getByRole('group', { name: 'Filter by status' });
    fireEvent.click(within(filters).getByRole('button', { name: /Unmatched/ }));
    expect(screen.queryByText('Email')).toBeNull();
    expect(screen.getByText('Mystery')).toBeTruthy();
    fireEvent.click(within(filters).getByRole('button', { name: /Filled/ }));
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.queryByText('Degree')).toBeNull();
    fireEvent.click(within(filters).getByRole('button', { name: 'All' }));
    expect(screen.getByText('Degree')).toBeTruthy();
  });

  it('refreshes on report:updated messages from the extension and on storage.session changes', async () => {
    await renderPanel();
    await screen.findByText('Email');

    await act(async () => {
      await storeReport(makeReport([field('n1', 'filled', { label: 'Phone', value: '123' })]));
    });
    await screen.findByText('Phone', undefined, WAIT);
    expect(screen.queryByText('Email')).toBeNull();

    // Broadcasts for another tab, from outside the extension, or from a content script are ignored.
    const broadcast = (tabId: number, label: string, sender: { id?: string; tab?: unknown }) =>
      act(async () => {
        await fakeBrowser.runtime.onMessage.trigger(
          { type: 'report:updated', tabId, report: makeReport([field('z', 'unmatched', { label })]) },
          sender as never,
          () => undefined,
        );
      });
    const self = { id: browser.runtime.id };
    await broadcast(TAB_ID + 1, 'Other tab', self);
    await broadcast(TAB_ID, 'Foreign sender', { id: 'someone-else' });
    await broadcast(TAB_ID, 'Content script', { ...self, tab: { id: 1 } });
    expect(screen.queryByText('Other tab')).toBeNull();
    expect(screen.queryByText('Foreign sender')).toBeNull();
    expect(screen.queryByText('Content script')).toBeNull();
    expect(screen.getByText('Phone')).toBeTruthy();

    await broadcast(TAB_ID, 'Broadcast field', self);
    await screen.findByText('Broadcast field', undefined, WAIT);
  });

  it('uses the active tab when there is no ?tabId override', async () => {
    window.history.replaceState({}, '', '/sidepanel.html');
    // fake-browser needs a window for currentWindow queries.
    const win = await fakeBrowser.windows.create({ focused: true });
    const tab = await fakeBrowser.tabs.create({ active: true, windowId: win!.id });
    await saveProfile(makeProfile());
    await storeReport(makeReport([field('t1', 'filled', { label: 'From active tab' })]), tab.id!);
    render(<App />);
    await screen.findByText('From active tab', undefined, WAIT);
  });
});

describe('Side panel – resume switcher', () => {
  it('lists resumes as "title (locale)" and writes the active resume', async () => {
    await renderPanel();
    const select = (await screen.findByLabelText('Active resume')) as HTMLSelectElement;
    expect([...select.options].map((o) => o.textContent)).toEqual(['Main (zh-CN)', 'English CV (en-AU)']);
    expect(select.value).toBe('r1');
    fireEvent.change(select, { target: { value: 'r2' } });
    await waitFor(async () => expect((await loadProfile()).activeResumeId).toBe('r2'), WAIT);
  });
});

describe('Side panel – field messages', () => {
  it('row click sends field:focus with tab, frame and field id', async () => {
    const received = listenAsBackground();
    await renderPanel();
    await screen.findByText('Fax');
    fireEvent.click(rowOf('Fax'));
    await waitFor(() => expect(received).toHaveLength(1), WAIT);
    expect(received[0]).toEqual({ type: 'field:focus', tabId: TAB_ID, frameId: 2, fieldId: 'c4' });
  });

  it('candidate "Use" sends field:apply with optionLabel and shows the result', async () => {
    const received = listenAsBackground((msg) =>
      msg.type === 'field:apply' ? field(msg.fieldId, 'filled', { label: 'Degree', value: msg.optionLabel }) : undefined,
    );
    await renderPanel();
    await screen.findByText('Degree');
    const use = screen.getByRole('button', { name: 'Use "Master"' });
    expect(screen.getByRole('button', { name: 'Use "Bachelor"' })).toBeTruthy();
    fireEvent.click(use);

    await waitFor(() => expect(received.filter((m) => m.type === 'field:apply')).toHaveLength(1), WAIT);
    expect(received.find((m) => m.type === 'field:apply')).toEqual({
      type: 'field:apply',
      tabId: TAB_ID,
      frameId: 0,
      fieldId: 'c2',
      optionLabel: 'Master',
    });
    await screen.findByText('Applied', undefined, WAIT);
    expect(within(rowOf('Degree')).getByText('Master')).toBeTruthy();
    expect(rowOf('Degree').querySelector('.raf-chip-success')?.textContent).toBe('Filled');
    // Candidate buttons are gone once the field is filled, and the click did not trigger a focus message.
    expect(screen.queryByRole('button', { name: 'Use "Master"' })).toBeNull();
    expect(received.some((m) => m.type === 'field:focus')).toBe(false);
  });

  it('inline edit sends field:apply with text', async () => {
    const received = listenAsBackground((msg) =>
      msg.type === 'field:apply' ? field(msg.fieldId, 'filled', { label: 'Mystery', value: msg.text }) : undefined,
    );
    await renderPanel();
    await screen.findByText('Mystery');
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Mystery"' }));
    const input = screen.getByLabelText('New value for "Mystery"');
    fireEvent.change(input, { target: { value: 'typed value' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));

    await waitFor(() => expect(received.filter((m) => m.type === 'field:apply')).toHaveLength(1), WAIT);
    expect(received.find((m) => m.type === 'field:apply')).toEqual({
      type: 'field:apply',
      tabId: TAB_ID,
      frameId: 0,
      fieldId: 'c3',
      text: 'typed value',
    });
    await screen.findByText('Applied', undefined, WAIT);
    expect(screen.queryByLabelText('New value for "Mystery"')).toBeNull();
  });

  it('keeps the editor open and reports an error when the page cannot apply', async () => {
    listenAsBackground((msg) => (msg.type === 'field:apply' ? field(msg.fieldId, 'action_failed', { label: 'Mystery' }) : undefined));
    await renderPanel();
    await screen.findByText('Mystery');
    fireEvent.click(screen.getByRole('button', { name: 'Edit "Mystery"' }));
    fireEvent.change(screen.getByLabelText('New value for "Mystery"'), { target: { value: 'x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    await screen.findByText('Apply failed: Failed', undefined, WAIT);
    expect(screen.getByLabelText('New value for "Mystery"')).toBeTruthy();
  });

  it('does not offer candidate buttons for rows that are not needs_review / no_option', async () => {
    await renderPanel();
    await screen.findByText('Email');
    // Only the needs_review row (two candidates) has Use buttons; every row has an edit button.
    expect(screen.getAllByRole('button', { name: /^Use "/ })).toHaveLength(2);
    expect(rowOf('Mystery').nextElementSibling?.classList.contains('raf-row-actions')).toBe(false);
    expect(screen.getAllByRole('button', { name: /^Edit "/ })).toHaveLength(4);
  });
});
