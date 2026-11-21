import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import { Fab } from '../../../entrypoints/fab.content/Fab';
import { setLanguage } from '../../../src/i18n';
import type { FieldReport, FillReport, Outcome } from '../../../src/engine/types';
import { ProfileSchema, ResumeSchema, createSampleProfile } from '../../../src/schema';
import { loadProfile, saveProfile, setActiveResume } from '../../../src/storage';

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
  send.mock.calls.map((c) => (c[0] as { type: string }).type).filter((type) => type !== 'scan:query' && type !== 'wizard:query');

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
/** The card's groups of rows, by reason. */
const groups = () => screen.queryAllByTestId('raf-group');
const groupOf = (id: string) => groups().find((g) => g.dataset.group === id)!;
/** Open a group the way a click on its heading does. */
const expand = (id: string) => fireEvent.click(groupOf(id).querySelector('summary')!);
const expandAll = () => groups().forEach((g) => fireEvent.click(g.querySelector('summary')!));
const rowNames = () => screen.queryAllByTestId('raf-item').map((r) => r.querySelector('.raf-list-item__name')?.textContent);

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
  it('asks the background for the current scan total and the multi-page session on mount (the first push may have been missed)', () => {
    render(<Fab />);
    expect(send.mock.calls.map((c) => (c[0] as { type: string }).type)).toEqual(['scan:query', 'wizard:query']);
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
    expect(button().disabled).toBe(false);
    // Every field not filled has a row, in a group by reason; the groups start closed and say how many they hold.
    expect(groups().map((g) => [g.dataset.group, g.querySelector('.raf-group__count')?.textContent])).toEqual([
      ['review', '1'],
      ['no_option', '1'],
      ['failed', '1'],
      ['nodata', '1'],
    ]);
    expect(rowNames()).toEqual([]);
    expandAll();
    expect(rowNames()).toEqual(['School', 'Label d', 'Mystery', 'Passport']);
    expect(button().querySelector('.raf-fab__sub')?.textContent).toBe('2 filled · 2 need review · 1 not filled');
    expect(screen.queryByText('Label a')).toBeNull(); // filled fields are not listed
    expect(screen.getByTestId('raf-card').textContent).not.toContain('SECRET-VALUE');
  });

  it('names each group by its reason with its icon, and gives every row a locate IconButton', async () => {
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
    await screen.findByTestId('raf-card');
    const titles = groups().map((g) => [g.querySelector('.raf-group__title')?.textContent, g.querySelector('summary svg')?.getAttribute('data-icon')]);
    expect(titles).toEqual([
      ['Needs review', 'exclamation-circle'],
      ['No matching option', 'exclamation-circle'],
      ['Not recognized', 'question-circle'],
      ['No data in resume', 'info-circle'],
    ]);
    expandAll();
    const rows = screen.getAllByTestId('raf-item');
    expect(rows).toHaveLength(5);
    const row = (name: string) => rows.find((r) => r.textContent?.includes(name))!;
    // A fill that failed says so under its name; the group says the rest.
    expect(row('Mystery').querySelector('.raf-list-item__crumb')?.textContent).toBe('Fill failed');
    expect(row('Unnamed field').querySelector('.raf-list-item__name')?.getAttribute('data-empty')).toBe('true');
    for (const r of rows) {
      const locate = r.querySelector('button')!;
      expect(locate.getAttribute('aria-label')).toBe('Locate this field');
      expect(locate.getAttribute('data-tip')).toBe('Locate this field'); // tooltip = same words as the label
      expect(locate.querySelector('svg')?.getAttribute('data-icon')).toBe('search');
    }
  });

  it('lists a sensitive field held back by the settings under "to review", saying it was not written', async () => {
    render(<Fab />);
    fireEvent.click(button());
    deliver({
      type: 'report:updated',
      tabId: 1,
      report: report([
        field('i', 'needs_review', { label: 'ID number', fieldKey: 'basics.idNumber', note: 'sensitive_held' }),
        field('s', 'needs_review', { label: 'School' }),
      ]),
    });
    await screen.findByTestId('raf-card');
    if (groupOf('review').getAttribute('open') === null) expand('review');
    const rows = within(groupOf('review')).getAllByTestId('raf-item');
    const crumb = (name: string) => rows.find((r) => r.textContent?.includes(name))!.querySelector('.raf-list-item__crumb')?.textContent ?? '';
    expect(crumb('ID number')).toContain('Reminder only, not filled');
    expect(crumb('School')).not.toContain('Reminder only');
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
    expect(groups()).toEqual([]);
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
    expect(groups().map((g) => g.querySelector('.raf-group__title')?.textContent)).toEqual(['待确认', '未识别', '简历里没有']);
    expect(groupOf('nodata').querySelector('.raf-group__count')?.textContent).toBe('2');
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

  it('shows the background error with an "Open your profile" action that sends ui:openOptions', async () => {
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
    const open = screen.getByRole('button', { name: 'Open your profile' });
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
    expandAll();
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
    expandAll();
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

describe('Fab: resume language chip', () => {
  const ZH_NAME = 'Filling with the Chinese resume. Switch to English';
  const EN_NAME = 'Filling with the English resume. Switch to Chinese';

  it('shows the active resume language and switches it in one click, without filling or dragging', async () => {
    await saveProfile(createSampleProfile()); // sample-zh active, linked to sample-en
    render(<Fab />);
    const chip = await screen.findByRole('button', { name: ZH_NAME });
    expect(chip.textContent).toBe('中');
    expect(chip.closest('.raf-fab')).toBeNull(); // not inside the draggable fill button
    fireEvent.click(chip);
    await waitFor(async () => expect((await loadProfile()).activeResumeId).toBe('sample-en'));
    expect((await screen.findByRole('button', { name: EN_NAME })).textContent).toBe('EN');
    expect(sentTypes()).not.toContain('fill:request');
  });

  it('follows a resume switch made in the side panel', async () => {
    await saveProfile(createSampleProfile());
    render(<Fab />);
    await screen.findByRole('button', { name: ZH_NAME });
    await setActiveResume('sample-en');
    await screen.findByRole('button', { name: EN_NAME });
  });

  it('speaks the interface language', async () => {
    setLanguage('zh');
    await saveProfile(createSampleProfile());
    render(<Fab />);
    await screen.findByRole('button', { name: '填写用简历：中文版，点一下换成英文版' });
  });

  it('is not there when no resume is in the other language', async () => {
    await saveProfile(
      ProfileSchema.parse({
        schemaVersion: 1,
        resumes: [ResumeSchema.parse({ id: 'a', title: 'a', locale: 'zh-CN' })],
        activeResumeId: 'a',
      }),
    );
    render(<Fab />);
    await act(async () => {
      await loadProfile();
      await new Promise((r) => setTimeout(r, 20));
    });
    expect(screen.queryByRole('button', { name: /Filling with/ })).toBeNull();
  });

  it('is disabled while filling and gone while the result card is open', async () => {
    await saveProfile(createSampleProfile());
    answerFill({ ok: true });
    render(<Fab />);
    const chip = (await screen.findByRole('button', { name: ZH_NAME })) as HTMLButtonElement;
    fireEvent.click(button());
    await waitFor(() => expect(chip.disabled).toBe(true));
    deliver({ type: 'report:updated', report: report([field('a', 'filled')]) });
    expect(screen.queryByRole('button', { name: ZH_NAME })).toBeNull();
  });
});

describe('Fab: fields with no data', () => {
  /** The message the FAB sent of one type. */
  const sent = (type: string) => send.mock.calls.map((c) => c[0] as { type: string }).filter((m) => m.type === type);

  it('offers to add the missing data, and asks the background to open the profile page at the first such field', async () => {
    render(<Fab />);
    fireEvent.click(button());
    deliver({
      type: 'report:updated',
      tabId: 1,
      report: report([
        field('a', 'filled', { fieldKey: 'contact.email' }),
        field('b', 'no_data', { fieldKey: 'jobIntention.cities' }),
        field('c', 'no_data', { fieldKey: 'education.gpa', source: 'education[1].gpa' }),
      ]),
    });
    await screen.findByTestId('raf-card');
    // The way to the profile sits at the foot of the open "no data" group.
    expect(screen.queryByRole('button', { name: 'Add them to your profile' })).toBeNull();
    expand('nodata');
    fireEvent.click(screen.getByRole('button', { name: 'Add them to your profile' }));
    expect(sent('ui:openOptions')).toEqual([{ type: 'ui:openOptions', fieldKey: 'jobIntention.cities' }]);
  });

  it('still opens the profile page when no missing field names a resume field', async () => {
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: report([field('a', 'filled'), field('b', 'no_data')]) });
    await screen.findByTestId('raf-card');
    expand('nodata');
    fireEvent.click(screen.getByRole('button', { name: 'Add them to your profile' }));
    expect(sent('ui:openOptions')).toEqual([{ type: 'ui:openOptions' }]);
  });

  it('offers nothing to add when no field is missing data', async () => {
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: report([field('a', 'filled'), field('b', 'needs_review')]) });
    await screen.findByTestId('raf-card');
    expect(screen.queryByRole('button', { name: 'Add them to your profile' })).toBeNull();
  });

  it('says it in Chinese', async () => {
    setLanguage('zh');
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: report([field('b', 'no_data', { fieldKey: 'contact.email' })]) });
    await screen.findByTestId('raf-card');
    expand('nodata');
    expect(screen.getByRole('button', { name: '去补上' })).toBeTruthy();
  });
});

describe('Fab: the rows of fields not filled', () => {
  const twoRanks = () =>
    report([
      field('q', 'no_data', { label: 'QQ', section: 'basics' }),
      field('m', 'no_data', { label: '婚姻状况', section: 'basics' }),
      field('r1', 'no_data', { label: '专业排名', section: 'education', entry: 0, frameId: 2 }),
      field('g2', 'no_data', { label: 'GPA', section: 'education', entry: 1 }),
      field('r2', 'no_data', { label: '专业排名', section: 'education', entry: 1 }),
      field('s', 'needs_review', {
        label: '学校',
        section: 'education',
        entry: 0,
        note: 'picked_other_name',
        value: '星河示例理工大学',
        observed: '星河理工',
      }),
    ]);

  it('names the first three fields of a closed group, and stops naming them once it is open', async () => {
    setLanguage('zh');
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: twoRanks() });
    await screen.findByTestId('raf-card');
    expect(groupOf('nodata').querySelector('.raf-group__names')?.textContent).toBe('QQ、婚姻状况、专业排名…');
    expand('nodata');
    expect(groupOf('nodata').getAttribute('open')).not.toBeNull();
    expect(groupOf('nodata').querySelector('.raf-group__names')).toBeNull();
    expand('nodata');
    expect(groupOf('nodata').getAttribute('open')).toBeNull();
  });

  it('tells two fields of the same name apart by their section and entry', async () => {
    setLanguage('zh');
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: twoRanks() });
    await screen.findByTestId('raf-card');
    expand('nodata');
    const crumbs = screen.getAllByTestId('raf-item').map((r) => [r.querySelector('.raf-list-item__name')?.textContent, r.querySelector('.raf-list-item__crumb')?.textContent]);
    expect(crumbs).toEqual([
      ['QQ', '基本信息'],
      ['婚姻状况', '基本信息'],
      ['专业排名', '教育经历 · 第 1 条'],
      ['GPA', '教育经历 · 第 2 条'],
      ['专业排名', '教育经历 · 第 2 条'],
    ]);
  });

  it('shows the site’s option a search box picked under another name, never the resume’s wording', async () => {
    setLanguage('zh');
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: twoRanks() });
    await screen.findByTestId('raf-card');
    expand('review');
    const row = screen.getByTestId('raf-item');
    expect(row.querySelector('.raf-list-item__pick')?.textContent).toBe('选了「星河理工」，和简历写法不同');
    expect(screen.getByTestId('raf-card').textContent).not.toContain('星河示例理工大学');
  });

  it('a click on a row points at its field and keeps the row picked out, with the card still open', async () => {
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: twoRanks() });
    await screen.findByTestId('raf-card');
    expand('nodata');
    send.mockClear();
    const third = screen.getAllByTestId('raf-item')[2]!;
    fireEvent.click(third.querySelector('.raf-list-item__name')!);
    expect(send.mock.calls.map((c) => c[0])).toEqual([{ type: 'field:focus', frameId: 2, fieldId: 'r1' }]);
    expect(third.getAttribute('aria-current')).toBe('true');
    expect(screen.getAllByTestId('raf-item').filter((r) => r.getAttribute('aria-current') === 'true')).toHaveLength(1);
    expect(screen.getByTestId('raf-card')).toBeTruthy();
  });
});

describe('Fab: entries of repeated sections', () => {
  const withEntries = (): FillReport => {
    const r = report([
      field('s1', 'filled', { section: 'education', entry: 0 }),
      field('d1', 'filled', { section: 'education', entry: 0 }),
      field('r1', 'needs_review', { section: 'education', entry: 0 }),
      field('g1', 'no_data', { section: 'education', entry: 0 }),
      field('s2', 'filled', { section: 'education', entry: 1 }),
      field('g2', 'no_data', { section: 'education', entry: 1 }),
      field('w1', 'filled', { section: 'internship', entry: 0 }),
    ]);
    r.entries = [
      { section: 'education', index: 0, state: 'existing', label: '星河示例理工大学' },
      { section: 'education', index: 1, state: 'added', label: '云岭示例大学' },
      { section: 'internship', index: 0, state: 'added', label: '示例科技有限公司' },
      { section: 'internship', index: 1, state: 'skipped', reason: 'add_failed', button: '添加实习经历', label: '样例数据有限公司' },
    ];
    return r;
  };

  it('shows each entry: whether its card was there, added or skipped, what it holds, and why one was skipped', async () => {
    setLanguage('zh');
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: withEntries() });
    const block = await screen.findByTestId('raf-entries');
    // A section opens by itself when one of its entries needs a look or was skipped.
    const heads = Array.from(block.querySelectorAll('.raf-entries__head'));
    expect(heads.map((h) => [h.querySelector('.raf-entries__name')?.textContent, h.querySelector('.raf-card__note')?.textContent, h.querySelector('.raf-badge__text')?.textContent])).toEqual([
      ['教育经历', '2 / 2 条', '待确认'],
      ['实习经历', '1 / 2 条', '跳过'],
    ]);
    const rows = Array.from(block.querySelectorAll('[data-testid="raf-entry"]')).map((e) => [
      e.querySelector('.raf-entry__title')?.textContent,
      e.querySelector('.raf-entry__why')?.textContent,
      e.querySelector('.raf-badge__text')?.textContent,
      (e.querySelector('.raf-badge') as HTMLElement | null)?.dataset.tone,
    ]);
    expect(rows).toEqual([
      ['第 1 条 · 页面原有', '星河示例理工大学 · 已填 2 格，待确认 1 格，简历里没有 1 格', '待确认', 'warning'],
      ['第 2 条 · 新增', '云岭示例大学 · 已填 1 格，简历里没有 1 格', '已填好', 'success'],
      ['第 1 条 · 新增', '示例科技有限公司 · 已填 1 格', '已填好', 'success'],
      ['第 2 条 · 跳过', '样例数据有限公司 · 按了「添加实习经历」，页面没有多出一条', '跳过', 'danger'],
    ]);
  });

  it('keeps a section closed when every entry in it was filled, and opens it on a click', async () => {
    setLanguage('zh');
    const r = report([field('s1', 'filled', { section: 'education', entry: 0 }), field('s2', 'filled', { section: 'education', entry: 1 })]);
    r.entries = [
      { section: 'education', index: 0, state: 'existing', label: '星河示例理工大学' },
      { section: 'education', index: 1, state: 'added', label: '云岭示例大学' },
    ];
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: r });
    const block = await screen.findByTestId('raf-entries');
    expect(block.querySelector('.raf-badge__text')?.textContent).toBe('已填好');
    expect(block.querySelectorAll('[data-testid="raf-entry"]')).toHaveLength(0);
    fireEvent.click(block.querySelector('summary')!);
    const rows = Array.from(block.querySelectorAll('[data-testid="raf-entry"]'));
    expect(rows.map((e) => e.querySelector('.raf-entry__why')?.textContent)).toEqual(['星河示例理工大学 · 已填 1 格', '云岭示例大学 · 已填 1 格']);
  });

  it('leaves out a section whose one entry had its card on the page', async () => {
    const r = withEntries();
    r.entries = [...r.entries!, { section: 'languages', index: 0, state: 'existing' }];
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: r });
    const block = await screen.findByTestId('raf-entries');
    expect(Array.from(block.querySelectorAll('.raf-entries__name')).map((n) => n.textContent)).toEqual(['Education', 'Internships']);
  });

  it('does not call an entry filled when none of its fields was found', async () => {
    setLanguage('zh');
    const r = report([field('s1', 'filled', { section: 'education', entry: 0 })]);
    r.entries = [
      { section: 'education', index: 0, state: 'existing' },
      { section: 'education', index: 1, state: 'added' },
    ];
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: r });
    const block = await screen.findByTestId('raf-entries');
    fireEvent.click(block.querySelector('summary')!);
    const second = block.querySelectorAll('[data-testid="raf-entry"]')[1]!;
    expect(second.querySelector('.raf-entry__why')?.textContent).toBe('没有可填的格子');
    expect((second.querySelector('.raf-badge') as HTMLElement).dataset.tone).toBe('muted');
    expect(second.querySelector('.raf-badge__text')?.textContent).toBe('新增');
  });

  it('shows no entries block when every entry had its card on the page and each section has one', async () => {
    const r = report([field('s1', 'filled', { section: 'education', entry: 0 })]);
    r.entries = [{ section: 'education', index: 0, state: 'existing' }];
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: r });
    await screen.findByTestId('raf-card');
    expect(screen.queryByTestId('raf-entries')).toBeNull();
  });
});

describe('Fab: inspector HUD', () => {
  it('renders a non-blocking highlight overlay on inspector:hover and clears it on null', () => {
    render(<Fab />);
    deliver({
      type: 'inspector:hover',
      target: {
        rect: { left: 20, top: 40, width: 180, height: 32 },
        label: 'GitHub',
        fieldKey: 'links.github',
        section: 'links',
        confidence: 0.9,
        tag: 'input',
        fingerprint: { tag: 'input', nameAttr: 'github', labelTokens: ['github'] },
      },
    });
    const hud = screen.getByRole('status');
    expect(hud.className).toContain('raf-inspector-hud');
    expect(hud.textContent).toContain('GitHub -> links.github');

    deliver({ type: 'inspector:hover', target: null });
    expect(screen.queryByRole('status')).toBeNull();
  });
});

describe('Fab: auto-advance', () => {
  const session = (advance?: unknown) => ({
    tabId: 1,
    origin: 'https://jobs.example.test',
    resumeId: 'r1',
    resumeTitle: 'Main',
    stepCount: 1,
    lastUrl: 'https://jobs.example.test/apply/1',
    lastUpdatedAt: 1,
    ...(advance ? { advance } : {}),
  });
  let pageButtons: HTMLElement;

  beforeEach(() => {
    pageButtons = document.createElement('div');
    pageButtons.innerHTML = '<button>Back</button><button>Next</button>';
    document.body.appendChild(pageButtons);
  });
  afterEach(() => pageButtons.remove());

  async function filledStep(wizard: unknown) {
    render(<Fab />);
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: report([field('a', 'filled')]) });
    deliver({ type: 'wizard:updated', tabId: 1, session: wizard });
    await screen.findByTestId('raf-card');
  }

  it('offers to advance after a fill on a step with a Next button, and starts it on click', async () => {
    await filledStep(session());
    const start = screen.getByRole('button', { name: 'Advance to the last page' });
    expect(screen.getByText('It only presses Next. The final submit stays with you.')).toBeTruthy();
    send.mockClear();
    fireEvent.click(start);
    expect(sentTypes()).toEqual(['wizard:autoAdvance']);
  });

  it('does not offer it on the last step, where only a send button is left', async () => {
    pageButtons.innerHTML = '<button>Back</button><button>Submit application</button>';
    await filledStep(session());
    expect(screen.queryByRole('button', { name: 'Advance to the last page' })).toBeNull();
  });

  it('does not offer it outside a multi-page session', async () => {
    await filledStep(null);
    expect(screen.queryByRole('button', { name: 'Advance to the last page' })).toBeNull();
  });

  it('asks for the session on a freshly loaded step and shows the run with a Stop button', async () => {
    send.mockImplementation(async (m: { type: string }) => (m.type === 'wizard:query' ? session({ running: true, steps: 2 }) : { ok: true }));
    render(<Fab />);
    expect(await screen.findByText('Advancing on its own: 2 steps so far')).toBeTruthy();
    send.mockClear();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(sentTypes()).toEqual(['wizard:stopAdvance']);
  });

  it('says why it stopped, in the card of the last fill', async () => {
    await filledStep(session({ running: true, steps: 1 }));
    deliver({ type: 'wizard:updated', tabId: 1, session: session({ running: false, steps: 2, stopReason: 'final_step' }) });
    expect(screen.getByText('This is the last page. Check every page, then submit it yourself.')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Stop' })).toBeNull();
  });

  it("does not keep a step's numbers once the run moves on to a step with nothing to fill", async () => {
    // A page that changes steps in place (Breezy): the button stays, and a step of questions only sends no report.
    await filledStep(session({ running: true, steps: 0 }));
    deliver({ type: 'report:updated', tabId: 1, report: report([field('a', 'filled'), field('b', 'filled')]) });
    deliver({ type: 'wizard:updated', tabId: 1, session: session({ running: true, steps: 1 }) });
    expect(screen.getByTestId('raf-stats')).toBeTruthy();
    deliver({ type: 'wizard:updated', tabId: 1, session: session({ running: true, steps: 2 }) });
    expect(screen.queryByTestId('raf-stats')).toBeNull();
    expect(screen.getByTestId('raf-advance-empty').textContent?.trim()).toBe('Nothing on this page could be filled from your resume.');
    deliver({ type: 'wizard:updated', tabId: 1, session: session({ running: false, steps: 2, stopReason: 'needs_you' }) });
    expect(screen.queryByTestId('raf-stats')).toBeNull();
    expect(screen.getByTestId('raf-advance-stopped')).toBeTruthy();
    expect(button().getAttribute('aria-label')).not.toContain('filled');
  });

  it('keeps the numbers of a step that was filled', async () => {
    await filledStep(session({ running: true, steps: 0 }));
    deliver({ type: 'report:updated', tabId: 1, report: report([field('a', 'filled')]) });
    deliver({ type: 'wizard:updated', tabId: 1, session: session({ running: true, steps: 1 }) });
    deliver({ type: 'wizard:updated', tabId: 1, session: session({ running: false, steps: 1, stopReason: 'needs_you' }) });
    expect(screen.getByTestId('raf-stats')).toBeTruthy();
    expect(screen.queryByTestId('raf-advance-empty')).toBeNull();
  });

  it('does not repeat an old stop reason on a later fill of the same page', async () => {
    await filledStep(session({ running: true, steps: 1 }));
    deliver({ type: 'wizard:updated', tabId: 1, session: session({ running: false, steps: 1, stopReason: 'needs_you' }) });
    expect(screen.getByTestId('raf-advance-stopped')).toBeTruthy();
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: report([field('a', 'filled')]) });
    await screen.findByTestId('raf-card');
    expect(screen.queryByTestId('raf-advance-stopped')).toBeNull();
    expect(screen.getByRole('button', { name: 'Advance to the last page' })).toBeTruthy();
  });

  it('does not show the stop reason of a run that ended before this page loaded', async () => {
    send.mockImplementation(async (m: { type: string }) =>
      m.type === 'wizard:query' ? session({ running: false, steps: 2, stopReason: 'needs_you' }) : { ok: true },
    );
    render(<Fab />);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'wizard:query' }));
    fireEvent.click(button());
    deliver({ type: 'report:updated', tabId: 1, report: report([field('a', 'filled')]) });
    await screen.findByTestId('raf-card');
    expect(screen.queryByTestId('raf-advance-stopped')).toBeNull();
  });

  it('does not pop a card up for a run that ended before this page loaded', async () => {
    send.mockImplementation(async (m: { type: string }) =>
      m.type === 'wizard:query' ? session({ running: false, steps: 2, stopReason: 'needs_you' }) : { ok: true },
    );
    render(<Fab />);
    await waitFor(() => expect(send).toHaveBeenCalledWith({ type: 'wizard:query' }));
    expect(screen.queryByTestId('raf-card')).toBeNull();
  });
});
