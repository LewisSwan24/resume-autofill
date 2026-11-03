import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { Fab } from '../../../entrypoints/fab.content/Fab';
import { setLanguage } from '../../../src/i18n';
import type { FieldReport, FillReport, Outcome } from '../../../src/engine/types';

const OUTCOMES: Outcome[] = ['filled', 'needs_review', 'unmatched', 'no_data', 'no_control', 'no_option', 'action_failed'];

function field(fieldId: string, outcome: Outcome, extra: Partial<FieldReport> = {}): FieldReport {
  return { fieldId, label: `Label ${fieldId}`, fieldKey: null, section: null, outcome, confidence: 0.5, ...extra };
}

function report(fields: FieldReport[]): FillReport {
  const counts = Object.fromEntries(OUTCOMES.map((o) => [o, 0])) as Record<Outcome, number>;
  for (const f of fields) counts[f.outcome]++;
  return { url: 'https://example.test/', startedAt: 0, finishedAt: 1, fields, counts };
}

const bgSender = () => ({ id: browser.runtime.id });
/** Deliver a runtime message to the FAB's listener the way the browser would. */
function deliver(message: unknown, sender: { id?: string; tab?: unknown } = bgSender()) {
  act(() => {
    (fakeBrowser.runtime.onMessage as unknown as { trigger: (...a: unknown[]) => unknown }).trigger(message, sender);
  });
}

let send: ReturnType<typeof vi.fn>;
const sentTypes = () =>
  send.mock.calls.map((c) => (c[0] as { type: string }).type).filter((type) => type !== 'scan:query');

beforeEach(() => {
  fakeBrowser.reset();
  setLanguage('en');
  send = vi.fn().mockResolvedValue({ ok: true });
  vi.spyOn(browser.runtime, 'sendMessage').mockImplementation(send as never);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

/** Make ill:request answer with esult (an Error rejects); every other message resolves { ok: true }. */
function answerFill(result: unknown) {
  send.mockImplementation(async (m: { type: string }) => {
    if (m.type !== 'fill:request') return { ok: true };
    if (result instanceof Error) throw result;
    return result;
  });
}

const button = () => screen.getByTestId('raf-fab-button') as HTMLButtonElement;

describe('Fab: idle', () => {
  it('is muted with a "no fields" hint until scan:total reports fields', () => {
    render(<Fab />);
    expect(button().dataset.muted).toBe('true');
    expect(button().textContent).toContain('No form fields detected');
    deliver({ type: 'scan:total', total: 12 });
    expect(button().dataset.muted).toBe('false');
    expect(button().textContent).toContain('12 fields detected');
    deliver({ type: 'scan:total', total: 1 });
    expect(button().textContent).toContain('1 field detected');
  });

  it('renders in Chinese when the language is zh', () => {
    setLanguage('zh');
    render(<Fab />);
    deliver({ type: 'scan:total', total: 5 });
    expect(button().textContent).toContain('一键填写');
    expect(button().textContent).toContain('识别到 5 个字段');
  });

  it('ignores scan:total from content scripts (sender.tab) and from other extensions', () => {
    render(<Fab />);
    deliver({ type: 'scan:total', total: 9 }, { id: browser.runtime.id, tab: { id: 1 } });
    deliver({ type: 'scan:total', total: 9 }, { id: 'someone-else' });
    deliver({ type: 'scan:total', total: 9 }, {});
    deliver({ nope: true });
    expect(button().textContent).toContain('No form fields detected');
  });
});

describe('Fab: initial total', () => {
  it('asks the background for the current scan total on mount (the first push may have been missed)', () => {
    render(<Fab />);
    expect(send.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(['scan:query']);
  });
});

describe('Fab: fill flow', () => {
  it('sends fill:request, shows a busy disabled button, then the summary card on report:updated', async () => {
    render(<Fab />);
    fireEvent.click(button());
    await waitFor(() => expect(button().disabled).toBe(true));
    expect(sentTypes()).toEqual(['fill:request']);
    expect(button().getAttribute('aria-busy')).toBe('true');
    expect(button().textContent).toContain('Filling');

    deliver({
      type: 'report:updated',
      tabId: 1,
      report: report([
        field('a', 'filled'),
        field('b', 'filled'),
        field('c', 'needs_review', { label: 'School', frameId: 2, value: 'SECRET-VALUE' }),
        field('d', 'no_option'),
        field('e', 'unmatched', { label: 'Mystery' }),
        field('f', 'no_data', { label: 'Passport' }),
      ]),
    });

    const stats = await screen.findByTestId('raf-stats');
    expect(stats.textContent).toBe('Filled 2·To review 2·Unrecognized 1·No data 1');
    expect(button().disabled).toBe(false);
    expect(screen.getByText('School')).toBeTruthy();
    expect(screen.getByText('Passport')).toBeTruthy();
    expect(screen.queryByText('Label a')).toBeNull(); // filled fields are not listed
    expect(screen.getByTestId('raf-card').textContent).not.toContain('SECRET-VALUE');
  });

  it('shows the all-done message and hides the muted "no data" count when it is zero', async () => {
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: report([field('a', 'filled')]) });
    expect((await screen.findByTestId('raf-stats')).textContent).toBe('Filled 1·To review 0·Unrecognized 0');
    expect(screen.getByText('All detected fields were filled.')).toBeTruthy();
  });

  it('shows the report even when it arrives before the fill:request response', async () => {
    let resolve!: (v: { ok: boolean }) => void;
    send.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: report([field('a', 'filled')]) });
    await screen.findByTestId('raf-card');
    await act(async () => resolve({ ok: true }));
    expect(screen.getByTestId('raf-card')).toBeTruthy();
    expect(button().disabled).toBe(false);
  });

  it('shows the background error with an "Open settings" action that sends ui:openOptions', async () => {
    answerFill({ ok: false, error: 'No active resume' });
    render(<Fab />);
    fireEvent.click(button());
    expect(await screen.findByText('No active resume')).toBeTruthy();
    expect(button().disabled).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }));
    expect(sentTypes()).toEqual(['fill:request', 'ui:openOptions']);
  });

  it('maps background error codes to translated messages', async () => {
    for (const [code, text] of [['no_resume', /No resume is available/], ['no_frames', /nothing to fill/], ['busy', /already running/]] as const) {
      answerFill({ ok: false, error: code });
      const view = render(<Fab />);
      fireEvent.click(button());
      expect(await screen.findByText(text)).toBeTruthy();
      expect(screen.queryByText(code)).toBeNull();
      view.unmount();
    }
  });

  it('falls back to a generic error when sendMessage rejects', async () => {
    answerFill(new Error('Could not establish connection'));
    render(<Fab />);
    fireEvent.click(button());
    expect(await screen.findByText(/did not respond/)).toBeTruthy();
  });

  it('gives up when the background acknowledges but no report ever arrives', async () => {
    render(<Fab reportTimeoutMs={30} />);
    fireEvent.click(button());
    expect(await screen.findByText(/no result came back/)).toBeTruthy();
    expect(button().disabled).toBe(false);
  });
});

describe('Fab: summary card actions', () => {
  async function showCard() {
    render(<Fab />);
    fireEvent.click(button());
    deliver({
      type: 'report:updated',
      tabId: 1,
      report: report([field('c', 'needs_review', { label: 'School', frameId: 2 }), field('t', 'unmatched', { label: 'Top' })]),
    });
    await screen.findByTestId('raf-card');
    send.mockClear();
  }

  it('clicking an item sends field:focus with its frame and field id (default frame 0)', async () => {
    await showCard();
    fireEvent.click(screen.getByText('School'));
    fireEvent.click(screen.getByText('Top'));
    expect(send.mock.calls.map((c) => c[0])).toEqual([
      { type: 'field:focus', frameId: 2, fieldId: 'c' },
      { type: 'field:focus', frameId: 0, fieldId: 't' },
    ]);
  });

  it('"View details in side panel" sends ui:openSidePanel', async () => {
    await showCard();
    fireEvent.click(screen.getByRole('button', { name: 'View details in side panel' }));
    expect(send.mock.calls.map((c) => c[0])).toEqual([{ type: 'ui:openSidePanel' }]);
  });

  it('the close button and Escape dismiss the card', async () => {
    await showCard();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByTestId('raf-card')).toBeNull();

    deliver({ type: 'report:updated', tabId: 1, report: report([field('x', 'unmatched')]) });
    await screen.findByTestId('raf-card');
    fireEvent.keyDown(screen.getByTestId('raf-card'), { key: 'Escape' });
    expect(screen.queryByTestId('raf-card')).toBeNull();
  });

  it('ignores report:updated from a non-background sender', async () => {
    render(<Fab />);
    deliver({ type: 'report:updated', tabId: 1, report: report([field('x', 'unmatched')]) }, { id: browser.runtime.id, tab: { id: 3 } });
    expect(screen.queryByTestId('raf-card')).toBeNull();
  });
});
