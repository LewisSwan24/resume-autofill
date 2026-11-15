// Fill history and 「提交了吗？」 from the browser session, with fake OpenSession objects.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import type { OpenSession } from '../../../../mobile/app/src/browser/useBrowserSession';
import type { BrowserTarget, SessionState } from '../../../../mobile/app/src/browser/model/session';
import { DEMO_URL } from '../../../../mobile/app/src/browser/model/constants';
import { ApplicationRecordSchema, defaultAppState, type AppState, type ApplicationStatus } from '../../../../mobile/app/src/store/appStateStore';
import { useTrackerBrowserSync } from '../../../../mobile/app/src/tracker/useTrackerBrowserSync';
import { BackStackContext, createBackStack } from '../../../../mobile/app/src/ui';
import { setLanguage } from '../../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../../src/schema';

const profile: Profile = ProfileSchema.parse({
  schemaVersion: 1,
  resumes: [
    ResumeSchema.parse({ id: 'r1', title: '我的中文简历', locale: 'zh-CN', createdAt: 1, updatedAt: 1, basics: { familyName: '张', givenName: '三' } }),
  ],
  activeResumeId: 'r1',
});

const field = (fieldId: string, outcome: string) => ({ fieldId, outcome, section: 'basics', label: fieldId, value: 'x' });
const report = {
  url: 'https://jobs.example.com/apply',
  startedAt: 1,
  finishedAt: 2,
  fields: [field('a', 'filled'), field('b', 'filled'), field('c', 'needs_review'), field('d', 'no_data')],
  counts: {},
};

type Run = SessionState['run'];
const done = (runId: string, o: { sample?: boolean; undo?: boolean } = {}): Run =>
  ({
    phase: 'done',
    runId,
    report,
    frames: [0],
    handedOver: { fields: [], wholeSections: [], files: [], leaves: 0 },
    countAtFill: 4,
    framesAtFill: 1,
    undo: o.undo ? { restored: [], manual: [], addedCards: 0 } : null,
    unanswered: 0,
    fallback: false,
    sample: o.sample ?? false,
  }) as unknown as Run;

const session = (target: BrowserTarget, run: Run = { phase: 'idle' }, url = target.url): OpenSession =>
  ({
    session: {},
    native: {},
    state: { target, url, run, choice: { kind: 'default' }, frames: [], unreachable: 0, isolated: null } as unknown as SessionState,
  }) as unknown as OpenSession;

const target = (recentId = 'a'): BrowserTarget => ({ url: 'https://jobs.example.com/apply', demo: false, recentId });
const record = (status: ApplicationStatus = 'wish') =>
  ApplicationRecordSchema.parse({
    id: 'a',
    url: 'https://jobs.example.com/apply',
    host: 'jobs.example.com',
    company: '示例科技',
    status,
    statusAt: 1,
    createdAt: 1,
    openedAt: 1,
    updatedAt: 1,
  });

let latest: AppState;
let suppress: () => void;
let failing = false;
let failures = 0;
let clock = 1000;

function Harness({ browser, shown, initial }: { browser: OpenSession | null; shown: boolean; initial: AppState }) {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  latest = state;
  const sync = useTrackerBrowserSync({
    browser,
    profile,
    fillLanguage: 'active',
    appState: state,
    updateAppState: async (change) => {
      if (failing) return false;
      ref.current = change(ref.current);
      setState(ref.current);
      return true;
    },
    onSaveFailed: () => (failures += 1),
    browserShown: shown,
    now: () => clock,
  });
  suppress = sync.suppressAsk;
  return <BackStackContext.Provider value={createBackStack()}>{sync.element}</BackStackContext.Provider>;
}

function mount(initial: AppState = defaultAppState({ applications: [record()] })) {
  const view = render(<Harness browser={null} shown={false} initial={initial} />);
  const set = (browser: OpenSession | null, shown = browser !== null) => view.rerender(<Harness browser={browser} shown={shown} initial={initial} />);
  return set;
}

const history = () => latest.applications[0]!.history;
const ask = () => screen.queryByRole('dialog', { name: '提交了吗？' });

beforeEach(() => {
  setLanguage('zh');
  clock = 1000;
  failing = false;
  failures = 0;
});
afterEach(cleanup);

describe('useTrackerBrowserSync', () => {
  it('a finished fill adds a history entry with counts, resume and locale', async () => {
    const set = mount();
    const t = target();
    set(session(t, { phase: 'filling', runId: 'run1', index: 0, total: 1 } as Run));
    set(session(t, done('run1')));
    await waitFor(() => expect(history()).toHaveLength(1));
    expect(history()[0]).toEqual({ at: 1000, resumeId: 'r1', locale: 'zh-CN', filled: 2, attention: 1, skipped: 1, undone: false });
    expect(latest.applications[0]!.status).toBe('filling');
    set(session(t, done('run1')));
    expect(history()).toHaveLength(1);
  });

  it('a second fill in the same session adds another', async () => {
    const set = mount();
    const t = target();
    set(session(t, done('run1')));
    clock = 2000;
    set(session(t, { phase: 'idle' }));
    set(session(t, done('run2')));
    await waitFor(() => expect(history().map((h) => h.at)).toEqual([2000, 1000]));
  });

  it('undo marks it', async () => {
    const set = mount();
    const t = target();
    set(session(t, done('run1')));
    set(session(t, done('run1', { undo: true })));
    await waitFor(() => expect(history()[0]!.undone).toBe(true));
  });

  it('demo and sample fills are not recorded', async () => {
    const set = mount();
    set(session({ url: DEMO_URL, demo: true }, done('run1')));
    set(session(target(), done('run2', { sample: true })));
    set(session({ url: 'https://jobs.example.com/x', demo: false }, done('run3')));
    set(null);
    await act(async () => undefined);
    expect(history()).toEqual([]);
    expect(ask()).toBeNull();
  });

  it('closing after a fill asks 提交了吗？; 已提交 sets the status', async () => {
    const set = mount();
    const t = target();
    set(session(t, done('run1')));
    expect(ask()).toBeNull();
    set(null);
    const sheet = await screen.findByRole('dialog', { name: '提交了吗？' });
    expect(within(sheet).getByText('刚才在「示例科技」的网申页面填写过。如果已经提交，标记一下，方便之后跟进。')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('button', { name: '已提交' }));
    await waitFor(() => expect(latest.applications[0]!.status).toBe('submitted'));
    expect(ask()).toBeNull();
  });

  it('还没有 leaves it', async () => {
    const set = mount();
    set(session(target(), done('run1')));
    set(null);
    fireEvent.click(within(await screen.findByRole('dialog', { name: '提交了吗？' })).getByRole('button', { name: '还没有' }));
    await waitFor(() => expect(ask()).toBeNull());
    expect(latest.applications[0]!.status).toBe('filling');
  });

  it('no ask for 已提交 records or after an undone fill', async () => {
    let set = mount(defaultAppState({ applications: [record('submitted')] }));
    set(session(target(), done('run1')));
    set(null);
    await waitFor(() => expect(history()).toHaveLength(1));
    expect(ask()).toBeNull();
    cleanup();
    set = mount();
    const t = target();
    set(session(t, done('run1')));
    set(session(t, done('run1', { undo: true })));
    set(null);
    await waitFor(() => expect(history()[0]!.undone).toBe(true));
    expect(ask()).toBeNull();
  });

  it('suppressAsk (wipe) asks nothing', async () => {
    const set = mount();
    set(session(target(), done('run1')));
    act(() => suppress());
    set(null);
    await act(async () => undefined);
    expect(ask()).toBeNull();
  });

  it('the ask waits while the browser shows', async () => {
    const set = mount();
    set(session(target(), done('run1')));
    const other = session({ url: 'https://other.example.com/', demo: false, recentId: 'zz' });
    set(other, true);
    await act(async () => undefined);
    expect(ask()).toBeNull();
    set(other, false);
    expect(await screen.findByRole('dialog', { name: '提交了吗？' })).toBeTruthy();
  });
});

describe('useTrackerBrowserSync – edge cases', () => {
  it('a failed 已提交 save is reported', async () => {
    const set = mount();
    set(session(target(), done('run1')));
    await waitFor(() => expect(history()).toHaveLength(1));
    set(null);
    const sheet = await screen.findByRole('dialog', { name: '提交了吗？' });
    failing = true;
    fireEvent.click(within(sheet).getByRole('button', { name: '已提交' }));
    await waitFor(() => expect(failures).toBe(1));
    expect(latest.applications[0]!.status).toBe('filling');
  });
});
