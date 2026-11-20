import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { browser } from 'wxt/browser';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/sidepanel/App';
import type { FieldReport, FillReport, Outcome } from '../../../src/engine/types';
import { setLanguage } from '../../../src/i18n';
import type { UiToBg } from '../../../src/messaging';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../src/schema';
import { loadProfile, saveProfile, setUiLanguage } from '../../../src/storage';
import { PROFILE_FOCUS_KEY } from '../../../src/ui/pages';

const WAIT = { timeout: 4000 };
const TAB_ID = 7;

const makeProfile = (uiLanguage: 'zh' | 'en' = 'en', resumes = true): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    resumes: resumes
      ? [
          ResumeSchema.parse({ id: 'r1', title: 'Main', locale: 'zh-CN' }),
          ResumeSchema.parse({ id: 'r2', title: 'English CV', locale: 'en-AU' }),
        ]
      : [],
    activeResumeId: resumes ? 'r1' : null,
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
  field('c1', 'filled', { label: 'Email', value: 'a@b.test', source: 'contact.email', confidence: 0.92 }),
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

/** The list item (`li` > `details`) of a field, found by its label. */
const rowOf = (label: string) => screen.getByText(label).closest('li') as HTMLLIElement;
const summaryOf = (label: string) => rowOf(label).querySelector('summary') as HTMLElement;
/** Expand a row without clicking (a click on the summary also sends field:focus). */
const expand = (label: string) => {
  (rowOf(label).querySelector('details') as HTMLDetailsElement).open = true;
  return rowOf(label);
};

beforeEach(() => {
  fakeBrowser.reset();
  setLanguage('en');
});
afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
  setLanguage('en');
  window.history.replaceState({}, '', '/');
});

describe('Side panel – toolbar and summary', () => {
  it('shows the title, the resume select and a refresh button in the toolbar', async () => {
    await renderPanel();
    const select = await screen.findByLabelText('Active resume');
    const toolbar = select.closest('.raf-toolbar') as HTMLElement;
    expect(within(toolbar).getByRole('heading', { name: 'Fill report' })).toBeTruthy();
    const refresh = within(toolbar).getByRole('button', { name: 'Refresh' });
    expect(refresh.getAttribute('data-tip')).toBe('Refresh');
  });

  it('writes a one-sentence summary in the chip groups: filled, to review, not filled', async () => {
    await renderPanel();
    // needs_review is "to review", unmatched is "not filled"; no_data is neutral and not mentioned.
    await screen.findByText('1 filled, 1 to review, 1 not filled');
    cleanup();
    await renderPanel({ report: makeReport([field('a', 'filled'), field('b', 'no_option')]) });
    await screen.findByText('1 filled, 1 to review');
    cleanup();
    await renderPanel({ report: makeReport([field('a', 'filled'), field('b', 'action_failed'), field('c', 'unmatched')]) });
    await screen.findByText('1 filled, 2 not filled');
    cleanup();
    await renderPanel({ report: makeReport([field('a', 'filled'), field('b', 'no_data')]) });
    await screen.findByText('1 filled, nothing needs a look');
  });
});

describe('Side panel – report list', () => {
  it('renders one list item per field, most urgent first, with the value on the meta line and a right-hand badge', async () => {
    await renderPanel();
    await screen.findByText('Email');
    expect(screen.queryByRole('table')).toBeNull();
    const names = [...document.querySelectorAll('.raf-item-name')].map((c) => c.textContent);
    // severity: needs_review → unmatched → no_data → filled
    expect(names).toEqual(['Degree', 'Mystery', 'Fax', 'Email']);
    expect(screen.getAllByRole('listitem')).toHaveLength(4);

    const email = rowOf('Email');
    const meta = email.querySelector('.raf-item-meta') as HTMLElement;
    // B1: the meta line is the value only, never a resume path.
    expect(meta.textContent).toBe('a@b.test');
    expect(meta.getAttribute('title')).toBe('a@b.test');
    // Filled rows: the badge in the row head carries the percentage and is not tone-coloured.
    const badge = email.querySelector('summary .raf-badge') as HTMLElement;
    expect(badge.textContent).toContain('92%');
    expect(badge.getAttribute('style') ?? '').not.toMatch(/color/);
    expect(badge.hasAttribute('data-tone')).toBe(false);
    // A field without value or source still gets a meta line.
    expect((rowOf('Fax').querySelector('.raf-item-meta') as HTMLElement).textContent).toBe('—');
  });

  it('never prints a raw resume path on the collapsed row; the expanded area explains the source in words', async () => {
    const report = makeReport([
      field('p1', 'filled', { label: 'Full name', value: '林知远', source: 'basics.familyName+givenName', confidence: 1 }),
      field('p2', 'filled', { label: 'Lang', value: '英语', source: 'languages[0].language', confidence: 1 }),
      field('p3', 'filled', { label: 'City', value: 'Brisbane', source: 'contact.address.city', confidence: 1 }),
      field('p4', 'filled', { label: 'School', value: 'PKU', source: 'education[1].school', confidence: 1 }),
      field('p5', 'filled', { label: 'Pic', value: 'photo.png', source: 'attachments.photoFileId', confidence: 1 }),
      field('p6', 'filled', { label: 'Mystery path', value: 'x', source: 'nothing.known[2].here', confidence: 1 }),
    ]);
    await renderPanel({ report });
    await screen.findByText('Full name');
    const metaOf = (label: string) => (rowOf(label).querySelector('.raf-item-meta') as HTMLElement).textContent;
    expect(metaOf('Full name')).toBe('林知远');
    expect(metaOf('Lang')).toBe('英语');
    for (const row of document.querySelectorAll('.raf-item-head')) expect(row.textContent).not.toMatch(/basics\.|languages\[|contact\.|education\[|attachments\./);

    const sourceOf = (label: string) => expand(label).querySelector('.raf-source') as HTMLElement;
    expect(sourceOf('Full name').textContent).toBe('Source: Basics › Family name + Given name');
    expect(sourceOf('Full name').getAttribute('title')).toBe('basics.familyName+givenName'); // raw path = tooltip only
    expect(sourceOf('Lang').textContent).toBe('Source: Languages 1 › Language');
    expect(sourceOf('City').textContent).toBe('Source: Contact › City');
    expect(sourceOf('School').textContent).toBe('Source: Education 2 › School');
    expect(sourceOf('Pic').textContent).toBe('Source: Attachments › Photo');
    // Unknown paths fall back to the raw text rather than hiding the source.
    expect(sourceOf('Mystery path').textContent).toBe('Source: nothing.known[2].here');
  });

  it('shows confidence (badge + bar) only for filled / needs_review rows; every other row gets a status badge instead', async () => {
    const outcomes: Outcome[] = ['filled', 'needs_review', 'no_data', 'no_option', 'no_control', 'unmatched', 'action_failed'];
    // Confidence 1 on every row, as the engine reports it for rows it did not fill.
    const report = makeReport(outcomes.map((o) => field(o, o, { label: `Row ${o}`, confidence: 1 })));
    await renderPanel({ report });
    await screen.findByText('Row filled');
    for (const outcome of outcomes) {
      const row = expand(`Row ${outcome}`);
      const head = row.querySelector('summary') as HTMLElement;
      const hasBar = within(row).queryByRole('progressbar') !== null;
      if (outcome === 'filled') {
        expect(head.querySelector('.raf-badge-confidence')?.textContent).toContain('100%');
        expect(head.querySelector('[data-outcome]')).toBeNull();
        expect(hasBar).toBe(true);
      } else {
        // collapsed non-filled row: outlined status badge (icon + word) in the right slot, no percentage
        const badge = head.querySelector(`.raf-badge[data-outcome="${outcome}"]`) as HTMLElement;
        expect(badge).toBeTruthy();
        expect(badge.querySelector('[data-icon]')).toBeTruthy();
        expect(badge.textContent?.trim().length).toBeGreaterThan(2);
        expect(head.querySelector('.raf-badge-confidence')).toBeNull();
        expect(head.textContent).not.toContain('%');
        // needs_review keeps the bar in the expanded area; the rest have none
        expect(hasBar).toBe(outcome === 'needs_review');
        expect(row.querySelector('.raf-confidence') !== null).toBe(outcome === 'needs_review');
      }
    }
  });

  it('says why a file was held back, and only on that row', async () => {
    const report = makeReport([
      field('held', 'needs_review', { label: 'Resume', value: 'Resume.pdf', note: 'same_file_held' }),
      field('other', 'needs_review', { label: 'Photo', value: 'photo.png' }),
    ]);
    await renderPanel({ report });
    await screen.findByText('Resume');
    expect(rowOf('Resume').querySelector('.raf-field-note')?.textContent).toMatch(/同名|same name/);
    expect(rowOf('Photo').querySelector('.raf-field-note')).toBeNull();
  });

  it('shows no confidence for a filled row without a numeric confidence', async () => {
    await renderPanel({ report: makeReport([field('x', 'filled', { label: 'No score', value: 'v', confidence: undefined as never })]) });
    await screen.findByText('No score');
    const row = expand('No score');
    expect(row.querySelector('.raf-badge-confidence')).toBeNull();
    expect(within(row).queryByRole('progressbar')).toBeNull();
  });

  it('expresses status by icon + word, never colour alone', async () => {
    await renderPanel();
    await screen.findByText('Email');
    const expected: Array<[string, Outcome, string, string]> = [
      ['Email', 'filled', 'Filled', 'check-circle'],
      ['Degree', 'needs_review', 'Needs review', 'exclamation-circle'],
      ['Mystery', 'unmatched', 'Not recognized', 'question-circle'],
      ['Fax', 'no_data', 'No data in resume', 'info-circle'],
    ];
    for (const [label, outcome, word, icon] of expected) {
      const row = rowOf(label);
      // closed row: the tile icon has the status word as its accessible name
      const tileIcon = within(row.querySelector('.raf-tile') as HTMLElement).getByRole('img', { name: word });
      expect(tileIcon.getAttribute('data-icon')).toBe(icon);
      // outlined badge with icon and the word: in the collapsed head for non-filled rows, in the expanded area for filled ones
      const badge = row.querySelector(`.raf-badge[data-outcome="${outcome}"]`) as HTMLElement;
      expect(badge.textContent?.trim()).toBe(word);
      expect(badge.querySelector(`[data-icon="${icon}"]`)).toBeTruthy();
      expect(badge.style.borderColor).not.toBe('');
      expect(Boolean(row.querySelector(`summary .raf-badge[data-outcome="${outcome}"]`))).toBe(outcome !== 'filled');
    }
    expect(screen.getByText('1 filled, 1 to review, 1 not filled')).toBeTruthy();
  });

  it('keeps rows collapsed until opened; the expanded area shows confidence as a progress bar with the number', async () => {
    await renderPanel();
    await screen.findByText('Email');
    const details = [...document.querySelectorAll('details.raf-item')] as HTMLDetailsElement[];
    expect(details).toHaveLength(4);
    expect(details.every((d) => !d.open)).toBe(true);

    const row = expand('Email');
    const bar = within(row).getByRole('progressbar', { name: 'Confidence' });
    expect(bar.getAttribute('aria-valuenow')).toBe('92');
    expect(bar.getAttribute('aria-valuemin')).toBe('0');
    expect(bar.getAttribute('aria-valuemax')).toBe('100');
    expect(within(row).getAllByText('92%').length).toBeGreaterThanOrEqual(2); // head badge + number next to the bar
    expect(within(row).getByText('Source: Contact › Email')).toBeTruthy();
    expect(within(row).getByRole('button', { name: 'Locate this field' }).getAttribute('data-tip')).toBe('Locate this field');
  });

  it('shows the empty state when the tab has no report', async () => {
    await renderPanel({ report: null });
    await screen.findByText('Press the Autofill button on the page. Results will show up here.');
    expect(screen.getByText('Nothing here yet')).toBeTruthy();
    expect(document.querySelector('.raf-empty-tile')).toBeTruthy();
    expect(document.querySelector('.raf-empty')?.classList.contains('raf-empty-compact')).toBe(false);
    expect(screen.queryByRole('listitem')).toBeNull();
    expect(screen.queryByRole('group', { name: 'Filter by status' })).toBeNull();
  });

  it('shows a loading skeleton announced once with role=status, then the list', async () => {
    window.history.replaceState({}, '', `/sidepanel.html?tabId=${TAB_ID}`);
    await saveProfile(makeProfile());
    await storeReport(makeReport(FIELDS));
    render(<App />);
    const loading = screen.getByRole('status', { name: 'Just a moment' });
    expect(loading.getAttribute('aria-busy')).toBe('true');
    expect(loading.querySelectorAll('.raf-skeleton').length).toBeGreaterThan(0);
    await screen.findByText('Email');
    expect(screen.queryByRole('status', { name: 'Just a moment' })).toBeNull();
  });

  it('renders the Chinese empty state, summary and labels when the UI language is zh', async () => {
    await renderPanel({ profile: makeProfile('zh'), report: null });
    await screen.findByText('点一下页面上的“一键填写”按钮，结果会出现在这里。');
    expect(screen.getByText('这里还空着')).toBeTruthy();
    cleanup();
    await renderPanel({
      profile: makeProfile('zh'),
      report: makeReport([field('z1', 'filled', { label: '姓名', value: '林知远', source: 'basics.familyName+givenName', confidence: 1 })]),
    });
    await screen.findByText('姓名');
    // The language switches once the profile has loaded, which can be just after the row appears.
    const row = expand('姓名');
    await waitFor(() => expect(row.querySelector('.raf-source')?.textContent).toBe('来源：基本信息 › 姓 + 名'));
    cleanup();
    await renderPanel({ profile: makeProfile('zh') });
    await screen.findByText('Email');
    // The language switches once the profile is read, so wait for the Chinese text instead of reading it at once.
    await screen.findByText('已填 1 个，1 个待确认，1 个未填写', undefined, WAIT);
    expect(screen.getByRole('heading', { name: '填写报告' })).toBeTruthy();
    expect(within(rowOf('Degree')).getByText('待确认', { selector: '.raf-badge' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^没有匹配的选项|^简历里没有/ })).toBeTruthy();
  });

  it('shows a danger notice with a retry when the report cannot be read, and recovers', async () => {
    const get = vi.spyOn(fakeBrowser.storage.session, 'get').mockRejectedValueOnce(new Error('boom'));
    await renderPanel();
    const alert = await screen.findByRole('alert');
    expect(alert.classList.contains('raf-notice-danger')).toBe(true);
    expect(within(alert).getByText("Couldn't load the report")).toBeTruthy();
    expect(screen.queryByText('Nothing here yet')).toBeNull();

    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await screen.findByText('Email', undefined, WAIT);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(get).toHaveBeenCalled();
  });

  it('refresh button reads the report again', async () => {
    await renderPanel();
    await screen.findByText('Email');
    const get = vi.spyOn(fakeBrowser.storage.session, 'get');
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }));
    await waitFor(() => expect(get).toHaveBeenCalledWith(`report:${TAB_ID}`), WAIT);
  });

  it('tells the user when there is no resume yet', async () => {
    await renderPanel({ profile: makeProfile('en', false) });
    await screen.findByText('No resume yet. Fill one in on the profile page and it will show up here.');
    expect(screen.queryByLabelText('Active resume')).toBeNull();
  });
});

describe('Side panel – filter chips', () => {
  it('lists only non-empty tone groups with icon and count in the text, and toggles aria-pressed', async () => {
    await renderPanel();
    await screen.findByText('Email');
    const filters = screen.getByRole('group', { name: 'Filter by status' });
    const names = within(filters)
      .getAllByRole('button')
      .map((b) => b.textContent?.trim());
    // All, then STATUS_GROUPS order (filled, review, failed, nodata) filtered to the groups that occur
    expect(names).toEqual(['All 4', 'Filled 1', 'Needs review 1', 'Not filled 1', 'No data in resume 1']);
    expect(within(filters).queryByRole('button', { name: /Fill failed|No control|No matching option|Not recognized/ })).toBeNull();
    // one scrollable row (no wrapping), chips keep a single line
    expect(filters.classList.contains('raf-chips-scroll')).toBe(true);
    expect(within(filters).getByRole('button', { name: 'All 4' }).getAttribute('aria-pressed')).toBe('true');
    const review = within(filters).getByRole('button', { name: 'Needs review 1' });
    expect(review.getAttribute('aria-pressed')).toBe('false');
    expect(review.querySelector('[data-icon="exclamation-circle"]')).toBeTruthy();
    expect(review.querySelector('[data-icon="check-lg"]')).toBeTruthy(); // the tick, shown by CSS when pressed
    fireEvent.click(review);
    expect(review.getAttribute('aria-pressed')).toBe('true');
    expect(within(filters).getByRole('button', { name: 'All 4' }).getAttribute('aria-pressed')).toBe('false');
  });

  it('a group chip covers every outcome in the group; rows keep their precise outcome word', async () => {
    const report = makeReport([
      field('g1', 'needs_review', { label: 'Review me' }),
      field('g2', 'no_option', { label: 'No option row' }),
      field('g3', 'unmatched', { label: 'Unmatched row' }),
      field('g4', 'action_failed', { label: 'Failed row' }),
      field('g5', 'filled', { label: 'Done row' }),
    ]);
    await renderPanel({ report });
    await screen.findByText('Done row');
    const filters = screen.getByRole('group', { name: 'Filter by status' });
    fireEvent.click(within(filters).getByRole('button', { name: 'Needs review 2' }));
    expect([...document.querySelectorAll('.raf-item-name')].map((n) => n.textContent)).toEqual(['Review me', 'No option row']);
    expect(within(rowOf('No option row')).getByText('No matching option', { selector: '.raf-badge' })).toBeTruthy();
    fireEvent.click(within(filters).getByRole('button', { name: 'Needs review 2' })); // off again
    fireEvent.click(within(filters).getByRole('button', { name: 'Not filled 2' }));
    expect([...document.querySelectorAll('.raf-item-name')].map((n) => n.textContent)).toEqual(['Failed row', 'Unmatched row']);
    expect(within(rowOf('Unmatched row')).getByText('Not recognized', { selector: '.raf-badge' })).toBeTruthy();
    expect(within(rowOf('Failed row')).getByText('Fill failed', { selector: '.raf-badge' })).toBeTruthy();
  });

  it('filters by group chips', async () => {
    await renderPanel();
    await screen.findByText('Email');
    const filters = screen.getByRole('group', { name: 'Filter by status' });
    fireEvent.click(within(filters).getByRole('button', { name: /Not filled/ }));
    expect(screen.queryByText('Email')).toBeNull();
    expect(screen.getByText('Mystery')).toBeTruthy();
    fireEvent.click(within(filters).getByRole('button', { name: /Filled/ }));
    expect(screen.getByText('Email')).toBeTruthy();
    expect(screen.queryByText('Degree')).toBeNull();
    fireEvent.click(within(filters).getByRole('button', { name: /^All/ }));
    expect(screen.getByText('Degree')).toBeTruthy();
  });
});

describe('Side panel – live updates', () => {
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

describe('Side panel – one-click switches', () => {
  it('the interface language toggle switches the panel at once and stores the choice', async () => {
    await renderPanel();
    const group = await screen.findByRole('group', { name: 'Interface language' });
    expect(within(group).getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(within(group).getByRole('button', { name: '中文' }));
    await screen.findByRole('heading', { name: '填写报告' }, WAIT);
    await waitFor(async () => expect((await loadProfile()).settings.uiLanguage).toBe('zh'), WAIT);
  });

  it('follows a language switch made elsewhere', async () => {
    await renderPanel();
    await screen.findByRole('group', { name: 'Interface language' });
    await setUiLanguage('zh');
    await screen.findByRole('group', { name: '界面语言' }, WAIT);
  });

  it('one click moves filling to the resume in the other language, and the next click comes back', async () => {
    await renderPanel(); // r1 Main (zh-CN) active, r2 English CV (en-AU)
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to English' }));
    await waitFor(async () => expect((await loadProfile()).activeResumeId).toBe('r2'), WAIT);
    await waitFor(() => expect((screen.getByLabelText('Active resume') as HTMLSelectElement).value).toBe('r2'), WAIT);
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to Chinese' }, WAIT));
    await waitFor(async () => expect((await loadProfile()).activeResumeId).toBe('r1'), WAIT);
  });

  it('prefers the linked resume over the first one in the other language', async () => {
    const profile = makeProfile();
    profile.resumes.push(ResumeSchema.parse({ id: 'r3', title: 'Linked CV', locale: 'en-AU' }));
    profile.resumes[0] = { ...profile.resumes[0]!, linkedResumeId: 'r3' };
    await renderPanel({ profile });
    fireEvent.click(await screen.findByRole('button', { name: 'Switch to English' }));
    await waitFor(async () => expect((await loadProfile()).activeResumeId).toBe('r3'), WAIT);
  });

  it('is disabled and says what to do when no resume is in the other language', async () => {
    const profile = makeProfile();
    profile.resumes[1] = ResumeSchema.parse({ id: 'r2', title: 'Another', locale: 'zh-CN' });
    await renderPanel({ profile });
    const button = (await screen.findByRole('button', { name: 'Switch to English' })) as HTMLButtonElement;
    expect(button.getAttribute('aria-disabled')).toBe('true');
    expect(button.title).toMatch(/profile page/);
  });
});

describe('Side panel – field messages', () => {
  it('row click sends field:focus with tab, frame and field id', async () => {
    const received = listenAsBackground();
    await renderPanel();
    await screen.findByText('Fax');
    fireEvent.click(summaryOf('Fax'));
    await waitFor(() => expect(received).toHaveLength(1), WAIT);
    expect(received[0]).toEqual({ type: 'field:focus', tabId: TAB_ID, frameId: 2, fieldId: 'c4' });
  });

  it('the Locate button sends field:focus too', async () => {
    const received = listenAsBackground();
    await renderPanel();
    await screen.findByText('Fax');
    fireEvent.click(within(expand('Fax')).getByRole('button', { name: 'Locate this field' }));
    await waitFor(() => expect(received).toHaveLength(1), WAIT);
    expect(received[0]).toEqual({ type: 'field:focus', tabId: TAB_ID, frameId: 2, fieldId: 'c4' });
  });

  it('candidate "Use" sends field:apply with optionLabel, merges the result and shows a Toast', async () => {
    const received = listenAsBackground((msg) =>
      msg.type === 'field:apply' ? field(msg.fieldId, 'filled', { label: 'Degree', value: msg.optionLabel }) : undefined,
    );
    await renderPanel();
    await screen.findByText('Degree');
    const row = expand('Degree');
    const candidates = within(row).getByRole('group', { name: 'Candidates' });
    expect(within(candidates).getByRole('button', { name: 'Use Bachelor' })).toBeTruthy();
    fireEvent.click(within(candidates).getByRole('button', { name: 'Use Master' }));

    await waitFor(() => expect(received.filter((m) => m.type === 'field:apply')).toHaveLength(1), WAIT);
    expect(received.find((m) => m.type === 'field:apply')).toEqual({
      type: 'field:apply',
      tabId: TAB_ID,
      frameId: 0,
      fieldId: 'c2',
      optionLabel: 'Master',
    });
    await screen.findByText('Updated', undefined, WAIT);
    expect(within(screen.getByText('Updated').closest('.raf-toast-stack') as HTMLElement).getByRole('button', { name: 'Dismiss' })).toBeTruthy();
    // The result is merged into the row: new value, new status.
    expect((rowOf('Degree').querySelector('.raf-item-meta') as HTMLElement).textContent).toBe('Master');
    expect(rowOf('Degree').querySelector('.raf-badge[data-outcome="filled"]')?.textContent?.trim()).toBe('Filled');
    // Candidate buttons are gone once the field is filled, and the click did not trigger a focus message.
    expect(screen.queryByRole('button', { name: 'Use Master' })).toBeNull();
    expect(received.some((m) => m.type === 'field:focus')).toBe(false);
  });

  it('manual edit: Input + Save sends field:apply with text', async () => {
    const received = listenAsBackground((msg) =>
      msg.type === 'field:apply' ? field(msg.fieldId, 'filled', { label: 'Mystery', value: msg.text }) : undefined,
    );
    await renderPanel();
    await screen.findByText('Mystery');
    const row = expand('Mystery');
    const input = within(row).getByLabelText('New value for "Mystery"') as HTMLInputElement;
    expect(within(row).getByText('New value')).toBeTruthy();
    fireEvent.change(input, { target: { value: 'typed value' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(received.filter((m) => m.type === 'field:apply')).toHaveLength(1), WAIT);
    expect(received.find((m) => m.type === 'field:apply')).toEqual({
      type: 'field:apply',
      tabId: TAB_ID,
      frameId: 0,
      fieldId: 'c3',
      text: 'typed value',
    });
    await screen.findByText('Updated', undefined, WAIT);
    expect((rowOf('Mystery').querySelector('.raf-item-meta') as HTMLElement).textContent).toBe('typed value');
  });

  it('prefills the edit input with the current value', async () => {
    await renderPanel();
    await screen.findByText('Email');
    const input = within(expand('Email')).getByLabelText('New value for "Email"') as HTMLInputElement;
    expect(input.value).toBe('a@b.test');
  });

  it('reports an error under the input when the page cannot apply, and keeps what was typed', async () => {
    listenAsBackground((msg) => (msg.type === 'field:apply' ? field(msg.fieldId, 'action_failed', { label: 'Mystery' }) : undefined));
    await renderPanel();
    await screen.findByText('Mystery');
    const row = expand('Mystery');
    fireEvent.change(within(row).getByLabelText('New value for "Mystery"'), { target: { value: 'x' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Save' }));
    const alert = await within(row).findByRole('alert', undefined, WAIT);
    expect(alert.textContent).toContain("That didn't go through (Fill failed)");
    expect(screen.queryByText('Updated')).toBeNull();
  });

  it('does not offer candidate buttons for rows that are not needs_review / no_option', async () => {
    await renderPanel();
    await screen.findByText('Email');
    // Only the needs_review row (two candidates) has Use buttons; every row has an edit input and a Locate button.
    expect(screen.getAllByRole('button', { name: /^Use / })).toHaveLength(2);
    expect(rowOf('Mystery').querySelector('[role="group"]')).toBeNull();
    expect(document.querySelectorAll('.raf-item-body input[type="text"]')).toHaveLength(4);
    expect(screen.getAllByRole('button', { name: 'Locate this field' })).toHaveLength(4);
  });
});

describe('Side panel – way to the profile page and to help', () => {
  const spyOptions = () => vi.spyOn(fakeBrowser.runtime, 'openOptionsPage').mockResolvedValue(undefined);
  const spyTabs = () => vi.spyOn(fakeBrowser.tabs, 'create').mockResolvedValue({} as never);

  it('has an "Edit profile" button with its word in the toolbar that opens the profile page', async () => {
    const open = spyOptions();
    await renderPanel();
    const select = await screen.findByLabelText('Active resume');
    const toolbar = select.closest('.raf-toolbar') as HTMLElement;
    const edit = within(toolbar).getByRole('button', { name: 'Edit profile' });
    expect(edit.textContent).toContain('Edit profile');
    fireEvent.click(edit);
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('has a Help button in the toolbar that opens the help page in a tab', async () => {
    const create = spyTabs();
    await renderPanel();
    const select = await screen.findByLabelText('Active resume');
    const toolbar = select.closest('.raf-toolbar') as HTMLElement;
    const help = within(toolbar).getByRole('button', { name: 'Help' });
    expect(help.getAttribute('data-tip')).toBe('Help');
    fireEvent.click(help);
    expect(create).toHaveBeenCalledWith({ url: browser.runtime.getURL('/help.html') });
  });

  it('offers the profile page from the empty state', async () => {
    const open = spyOptions();
    await renderPanel({ report: null });
    await screen.findByText('Nothing here yet');
    const empty = document.querySelector('.raf-empty') as HTMLElement;
    fireEvent.click(within(empty).getByRole('button', { name: 'Fill in your profile' }));
    expect(open).toHaveBeenCalledTimes(1);
  });

  it('offers the profile page when there is no resume yet, and keeps the Edit profile button', async () => {
    const open = spyOptions();
    await renderPanel({ profile: makeProfile('en', false), report: null });
    const text = await screen.findByText('No resume yet. Fill one in on the profile page and it will show up here.');
    const notice = text.closest('.raf-notice') as HTMLElement;
    fireEvent.click(within(notice).getByRole('button', { name: 'Fill in your profile' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Edit profile' })).toBeTruthy();
  });

  it('a field with no data says where to add it; no other row does', async () => {
    const open = spyOptions();
    await renderPanel();
    await screen.findByText('Fax');
    const row = expand('Fax');
    fireEvent.click(within(row).getByRole('button', { name: 'Add it to your profile' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(screen.getAllByRole('button', { name: 'Add it to your profile' })).toHaveLength(1);
  });

  it('a field with no data asks the profile page to jump to its input', async () => {
    const open = spyOptions();
    const report = makeReport([
      field('n1', 'no_data', { label: 'Second school', fieldKey: 'education.school', source: 'education[1].school' }),
    ]);
    await renderPanel({ report });
    await screen.findByText('Second school');
    fireEvent.click(within(expand('Second school')).getByRole('button', { name: 'Add it to your profile' }));
    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const stored = await fakeBrowser.storage.session.get(PROFILE_FOCUS_KEY);
    expect(stored[PROFILE_FOCUS_KEY]).toMatchObject({ target: { module: 'education', entry: 1, field: 'school' } });
  });

  it('a field it cannot place just opens the profile page, with no jump request', async () => {
    const open = spyOptions();
    await renderPanel();
    await screen.findByText('Fax');
    fireEvent.click(within(expand('Fax')).getByRole('button', { name: 'Add it to your profile' }));
    expect(open).toHaveBeenCalledTimes(1);
    expect(await fakeBrowser.storage.session.get(PROFILE_FOCUS_KEY)).toEqual({});
  });

  it('speaks Chinese when the UI language is zh', async () => {
    await renderPanel({ profile: makeProfile('zh'), report: null });
    expect(await screen.findByRole('button', { name: '编辑简历资料' }, WAIT)).toBeTruthy();
    expect(screen.getByRole('button', { name: '使用说明' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '去填写简历资料' })).toBeTruthy();
  });
});

describe('Side panel – auto-advance', () => {
  const session = (advance?: unknown) => ({
    tabId: TAB_ID,
    origin: 'https://jobs.test',
    resumeId: 'r1',
    resumeTitle: 'Main',
    stepCount: 2,
    lastUrl: 'https://jobs.test/apply',
    lastUpdatedAt: Date.now(),
    ...(advance ? { advance } : {}),
  });
  const storeSession = (s: unknown) => fakeBrowser.storage.session.set({ [`wizard:${TAB_ID}`]: s });
  const sent = () => {
    const spy = vi.spyOn(browser.runtime, 'sendMessage').mockResolvedValue({ ok: true } as never);
    return () => spy.mock.calls.map((c) => c[0] as unknown as { type: string; tabId?: number }).filter((m) => m.type.startsWith('wizard:'));
  };

  it('offers to advance on a multi-page form and starts it for this tab', async () => {
    await storeSession(session());
    const messages = sent();
    await renderPanel();
    fireEvent.click(await screen.findByRole('button', { name: 'Advance to the last page' }, WAIT));
    expect(messages()).toEqual([{ type: 'wizard:autoAdvance', tabId: TAB_ID }]);
  });

  it('shows a run as it goes and stops it', async () => {
    await storeSession(session({ running: true, steps: 1 }));
    const messages = sent();
    await renderPanel();
    expect(await screen.findByText('Advancing on its own: 1 steps so far', undefined, WAIT)).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Advance to the last page' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(messages()).toEqual([{ type: 'wizard:stopAdvance', tabId: TAB_ID }]);
  });

  it('follows the run live and says why it stopped, even when the report lands after the news', async () => {
    await storeSession(session({ running: true, steps: 1 }));
    // No report yet: it arrives after the run's update, the order that made this test fail under load. A new
    // report has the panel read the session again, so the session is stored first, as the background does.
    await renderPanel({ report: null });
    await screen.findByText('Advancing on its own: 1 steps so far', undefined, WAIT);
    const stopped = session({ running: false, steps: 3, stopReason: 'needs_you' });
    await storeSession(stopped);
    act(() => {
      (fakeBrowser.runtime.onMessage as unknown as { trigger: (...a: unknown[]) => unknown }).trigger(
        { type: 'wizard:updated', tabId: TAB_ID, session: stopped },
        { id: browser.runtime.id },
      );
    });
    await act(async () => {
      await storeReport(makeReport(FIELDS));
    });
    expect(await screen.findByText('This page needs you: a required field is empty or the page shows an error.', undefined, WAIT)).toBeTruthy();
  });
});
