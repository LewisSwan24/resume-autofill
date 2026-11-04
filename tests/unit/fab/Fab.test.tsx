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

/** Make ill:request answer with 
esult (an Error rejects); every other message resolves { ok: true }. */
function answerFill(result: unknown) {
  send.mockImplementation(async (m: { type: string }) => {
    if (m.type !== 'fill:request') return { ok: true };
    if (result instanceof Error) throw result;
    return result;
  });
}

const button = () => screen.getByTestId('raf-fab-button') as HTMLButtonElement;

describe('Fab: idle', () => {
  it('is the outlined button with a muted caption until scan:total reports fields, then the primary button', () => {
    render(<Fab />);
    expect(button().dataset.muted).toBe('true');
    expect(button().classList.contains('raf-btn--primary')).toBe(false);
    expect(button().disabled).toBe(false); // explained, not disabled
    expect(button().textContent).toContain('No form fields detected');
    deliver({ type: 'scan:total', total: 12 });
    expect(button().dataset.muted).toBe('false');
    expect(button().classList.contains('raf-btn--primary')).toBe(true);
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
  it('sends fill:request, shows a busy button (spinner, aria-busy, still focusable), then the summary card on report:updated', async () => {
    render(<Fab />);
    button().focus();
    fireEvent.click(button());
    await waitFor(() => expect(button().getAttribute('aria-busy')).toBe('true'));
    expect(sentTypes()).toEqual(['fill:request']);
    expect(button().textContent).toContain('Filling');
    expect(button().querySelector('.raf-spinner')).not.toBeNull();
    expect(button().querySelector('[data-icon="file-earmark-text"]')).toBeNull();
    // Busy keeps focus (not `disabled`) and ignores further clicks.
    expect(button().disabled).toBe(false);
    expect(document.activeElement).toBe(button());
    fireEvent.click(button());
    expect(sentTypes()).toEqual(['fill:request']);

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
    // Outlined Badges: icon + word + number, vocabulary from status.* (one icon + word per status).
    const badges = Array.from(stats.querySelectorAll('.raf-badge'));
    expect(badges.map((b) => b.querySelector('.raf-badge__text')?.textContent)).toEqual(['Filled 2', 'Needs review 2', 'Not filled 1']);
    expect(badges.map((b) => b.querySelector('svg')?.getAttribute('data-icon'))).toEqual([
      'check-circle',
      'exclamation-circle',
      'x-circle',
    ]);
    expect(badges.map((b) => (b as HTMLElement).dataset.tone)).toEqual(['success', 'warning', 'danger']);
    expect(badges.every((b) => b.querySelector('svg')?.getAttribute('aria-hidden') === 'true')).toBe(true);
    // "No data" is a muted sentence, not a fourth badge.
    expect(screen.getByTestId('raf-nodata').textContent).toBe('1 field has no data in your resume.');
    expect(button().disabled).toBe(false);
    expect(screen.getByText('School')).toBeTruthy();
    expect(screen.queryByText('Passport')).toBeNull(); // no_data is only counted in the sentence, never listed
    expect(screen.getAllByTestId('raf-item').map((r) => r.querySelector('.raf-list-item__name')?.textContent)).toEqual(['School', 'Label d', 'Mystery']);
    expect(button().querySelector('.raf-fab__sub')?.textContent).toBe('2 filled · 2 need review · 1 not filled');
    expect(screen.queryByText('Label a')).toBeNull(); // filled fields are not listed
    expect(screen.getByTestId('raf-card').textContent).not.toContain('SECRET-VALUE');
  });

  it('lists non-filled fields as compact rows with a status Badge (icon + word) and a locate IconButton', async () => {
    render(<Fab />);
    fireEvent.click(button());
    deliver({
      type: 'report:updated',
      tabId: 1,
      report: report([
        field('c', 'needs_review', { label: 'School' }),
        field('d', 'no_option', { label: 'Language' }),
        field('e', 'action_failed', { label: 'Mystery' }),
        field('f', 'unmatched', { label: '' }),
        field('g', 'no_data', { label: 'Passport' }),
      ]),
    });
    const rows = await screen.findAllByTestId('raf-item');
    expect(rows).toHaveLength(4); // the no_data field is not a row
    const row = (name: string) => rows.find((r) => r.textContent?.includes(name))!;
    expect(row('School').querySelector('.raf-badge__text')?.textContent).toBe('Needs review');
    expect(row('Language').querySelector('.raf-badge__text')?.textContent).toBe('No matching option');
    expect(row('Mystery').querySelector('.raf-badge__text')?.textContent).toBe('Fill failed');
    expect(row('Mystery').querySelector('svg[data-icon="x-circle"]')).not.toBeNull();
    expect(row('Unnamed field').querySelector('.raf-badge__text')?.textContent).toBe('Not recognized');
    expect(row('Unnamed field').querySelector('.raf-list-item__name')?.getAttribute('data-empty')).toBe('true');
    for (const r of rows) {
      const locate = r.querySelector('button')!;
      expect(locate.getAttribute('aria-label')).toBe('Locate this field');
      expect(locate.getAttribute('data-tip')).toBe('Locate this field'); // tooltip = same words as the label
      expect(locate.querySelector('svg')?.getAttribute('data-icon')).toBe('search');
    }
  });

  it('shows the all-done Notice and drops the "no data" sentence and the list when nothing needs attention', async () => {
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: report([field('a', 'filled')]) });
    const stats = await screen.findByTestId('raf-stats');
    expect(Array.from(stats.querySelectorAll('.raf-badge__text')).map((b) => b.textContent)).toEqual(['Filled 1']);
    const done = screen.getByTestId('raf-alldone');
    expect(done.querySelector('.raf-notice__text')?.textContent).toBe('All detected fields were filled.');
    expect(done.querySelector('svg[data-icon="check-circle"]')).not.toBeNull();
    expect(screen.queryByTestId('raf-nodata')).toBeNull();
    expect(screen.queryByTestId('raf-list')).toBeNull();
  });

  it('never shows more than three Badges, pluralises the no-data sentence, and renders in Chinese', async () => {
    setLanguage('zh');
    render(<Fab />);
    fireEvent.click(button());
    deliver({
      type: 'report:updated',
      tabId: 1,
      report: report([
        field('a', 'filled'),
        field('b', 'needs_review'),
        field('c', 'unmatched'),
        field('d', 'no_data'),
        field('e', 'no_data'),
      ]),
    });
    const stats = await screen.findByTestId('raf-stats');
    expect(Array.from(stats.querySelectorAll('.raf-badge__text')).map((b) => b.textContent)).toEqual(['已填写 1', '待确认 1', '未填写 1']);
    expect(screen.getByTestId('raf-nodata').textContent).toBe('简历里没有 2 个字段的数据。');
    expect(screen.getByRole('button', { name: '在侧边栏查看明细' })).toBeTruthy();
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
    // Danger Notice: alert role, warning icon, title + explanation, secondary (outlined) button; no primary footer.
    const notice = screen.getByRole('alert');
    expect(notice.classList.contains('raf-notice--danger')).toBe(true);
    expect(notice.querySelector('svg[data-icon="exclamation-triangle"]')).not.toBeNull();
    expect(notice.querySelector('.raf-notice__title')?.textContent).toBe("Couldn't autofill");
    expect(screen.queryByRole('button', { name: 'View details in side panel' })).toBeNull();
    const open = screen.getByRole('button', { name: 'Open settings' });
    expect(open.classList.contains('raf-btn--primary')).toBe(false);
    fireEvent.click(open);
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

describe('Fab: caption after a fill', () => {
  const fillWith = async (fields: FieldReport[]) => {
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: report(fields) });
    await screen.findByTestId('raf-card');
  };

  it('shows the detected count before a fill and the result after it (caption and aria-label)', async () => {
    render(<Fab />);
    deliver({ type: 'scan:total', total: 42 });
    expect(button().textContent).toContain('42 fields detected');
    expect(button().getAttribute('aria-label')).toBe('Autofill — 42 fields detected');
    await fillWith([
      ...Array.from({ length: 44 }, (_, i) => field(`f${i}`, 'filled')),
      field('r1', 'needs_review'),
      field('r2', 'no_option'),
      field('n1', 'no_data'),
    ]);
    expect(button().querySelector('.raf-fab__sub')?.textContent).toBe('44 filled · 2 need review');
    expect(button().getAttribute('aria-label')).toBe('Autofill — 44 filled · 2 need review');
    expect(button().textContent).not.toContain('detected');
  });

  it('lists not-filled fields as their own part, and drops parts that are zero', async () => {
    render(<Fab />);
    await fillWith([field('a', 'filled'), field('b', 'needs_review'), field('c', 'unmatched'), field('d', 'action_failed')]);
    expect(button().querySelector('.raf-fab__sub')?.textContent).toBe('1 filled · 1 need review · 2 not filled');
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: report([field('a', 'filled'), field('z', 'no_data')]) });
    await waitFor(() => expect(button().querySelector('.raf-fab__sub')?.textContent).toBe('1 filled'));
  });

  it('is primary (not the muted outlined variant) after a fill even if the scan total is unknown', async () => {
    render(<Fab />);
    expect(button().dataset.muted).toBe('true');
    await fillWith([field('a', 'filled')]);
    expect(button().dataset.muted).toBe('false');
  });

  it('keeps the result after the card is closed, and returns to the detected count when a new fill fails', async () => {
    render(<Fab />);
    deliver({ type: 'scan:total', total: 5 });
    await fillWith([field('a', 'filled'), field('b', 'needs_review')]);
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(button().textContent).toContain('1 filled · 1 need review');
    answerFill({ ok: false, error: 'busy' });
    fireEvent.click(button());
    await screen.findByText(/already running/);
    expect(button().textContent).toContain('5 fields detected');
  });

  it('renders the result caption in Chinese', async () => {
    setLanguage('zh');
    render(<Fab />);
    await fillWith([field('a', 'filled'), field('b', 'filled'), field('c', 'needs_review')]);
    expect(button().querySelector('.raf-fab__sub')?.textContent).toBe('已填 2 · 1 项待确认');
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

  it('"Locate this field" sends field:focus with the frame and field id of its row (default frame 0)', async () => {
    await showCard();
    const locate = screen.getAllByRole('button', { name: 'Locate this field' });
    expect(locate).toHaveLength(2);
    // Each button is described by its row's field name.
    expect(locate.map((b) => document.getElementById(b.getAttribute('aria-describedby')!)?.textContent)).toEqual(['School', 'Top']);
    fireEvent.click(locate[0]!);
    fireEvent.click(locate[1]!);
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

  it('the close button and Escape dismiss the card and hand focus back to the FAB', async () => {
    await showCard();
    const close = screen.getByRole('button', { name: 'Close' });
    expect(close.getAttribute('data-tip')).toBe('Close');
    close.focus();
    fireEvent.click(close);
    expect(screen.queryByTestId('raf-card')).toBeNull();
    expect(document.activeElement).toBe(button());

    deliver({ type: 'report:updated', tabId: 1, report: report([field('x', 'unmatched')]) });
    await screen.findByTestId('raf-card');
    screen.getByRole('button', { name: 'Locate this field' }).focus();
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(screen.queryByTestId('raf-card')).toBeNull();
    expect(document.activeElement).toBe(button());

    // Escape also works while focus is already on the FAB, and does nothing without a card.
    deliver({ type: 'report:updated', tabId: 1, report: report([field('y', 'unmatched')]) });
    await screen.findByTestId('raf-card');
    button().focus();
    fireEvent.keyDown(button(), { key: 'Escape' });
    expect(screen.queryByTestId('raf-card')).toBeNull();
    fireEvent.keyDown(button(), { key: 'Escape' });
    expect(document.activeElement).toBe(button());
  });

  it('settles out (inert, data-state=leaving) before unmounting when motion is allowed', async () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: false });
    window.matchMedia = matchMedia as never;
    try {
      await showCard();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      const card = screen.getByTestId('raf-card');
      expect(card.getAttribute('data-state')).toBe('leaving');
      expect(card.hasAttribute('inert')).toBe(true);
      expect(document.activeElement).toBe(button());
      await waitFor(() => expect(screen.queryByTestId('raf-card')).toBeNull());
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  it('removes the card at once under prefers-reduced-motion', async () => {
    const matchMedia = vi.fn().mockReturnValue({ matches: true });
    window.matchMedia = matchMedia as never;
    try {
      await showCard();
      fireEvent.click(screen.getByRole('button', { name: 'Close' }));
      expect(screen.queryByTestId('raf-card')).toBeNull();
    } finally {
      delete (window as { matchMedia?: unknown }).matchMedia;
    }
  });

  it('ignores report:updated from a non-background sender', async () => {
    render(<Fab />);
    deliver({ type: 'report:updated', tabId: 1, report: report([field('x', 'unmatched')]) }, { id: browser.runtime.id, tab: { id: 3 } });
    expect(screen.queryByTestId('raf-card')).toBeNull();
  });
});
