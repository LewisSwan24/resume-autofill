// Mobile app navigation: which tab is shown, what each tab has open, jumps to a field, and the back key.
import { describe, expect, it } from 'vitest';
import { INITIAL_NAV, backFrom, navReduce, type BrowserSource, type NavState, type Tab } from '../../../mobile/app/src/navigation';

const at = (patch: Partial<NavState>): NavState => ({ ...INITIAL_NAV, ...patch });

describe('navReduce', () => {
  it('starts on home', () => {
    expect(INITIAL_NAV).toEqual({
      tab: 'home',
      module: null,
      focus: null,
      settingsPage: 'root',
      onboardingStep: 1,
      browser: null,
      tracker: { applicationId: null, filter: 'all', query: '', sort: 'opened' },
      pasteFocus: null,
    });
  });

  it('four tabs', () => {
    const tabs: Tab[] = ['home', 'applications', 'resume', 'settings'];
    for (const tab of tabs) expect(navReduce(INITIAL_NAV, { type: 'tab', tab }).tab).toBe(tab);
  });

  it("switching tabs keeps each tab's sub-state", () => {
    let s = navReduce(INITIAL_NAV, { type: 'tab', tab: 'resume' });
    s = navReduce(s, { type: 'module', module: 'education' });
    s = navReduce(s, { type: 'tab', tab: 'settings' });
    s = navReduce(s, { type: 'settingsPage', page: 'privacy' });
    s = navReduce(s, { type: 'tab', tab: 'home' });
    expect(s).toMatchObject({ tab: 'home', module: 'education', settingsPage: 'privacy' });
    s = navReduce(s, { type: 'tab', tab: 'resume' });
    expect(s).toMatchObject({ tab: 'resume', module: 'education', settingsPage: 'privacy' });
  });

  it('tapping the current tab returns it to its root', () => {
    const resume = navReduce(at({ tab: 'resume', module: 'basics', settingsPage: 'privacy' }), { type: 'tab', tab: 'resume' });
    expect(resume).toMatchObject({ tab: 'resume', module: null, settingsPage: 'privacy' });
    const settings = navReduce(at({ tab: 'settings', module: 'basics', settingsPage: 'privacy' }), { type: 'tab', tab: 'settings' });
    expect(settings).toMatchObject({ tab: 'settings', module: 'basics', settingsPage: 'root' });
  });

  it('jump goes to the resume tab, opens the module, sets a focus with a new nonce each time', () => {
    const target = { module: 'basics' as const, field: 'phone' };
    const first = navReduce(INITIAL_NAV, { type: 'jump', target });
    expect(first).toMatchObject({ tab: 'resume', module: 'basics', focus: { module: 'basics', field: 'phone' } });
    const done = navReduce(first, { type: 'focusDone' });
    expect(done.focus).toBeNull();
    const second = navReduce(done, { type: 'jump', target });
    expect(second.focus).not.toBeNull();
    expect(second.focus!.nonce).not.toBe(first.focus!.nonce);
    const third = navReduce(second, { type: 'jump', target: { module: 'education', field: 'school', entry: 0 } });
    expect(third.focus).toMatchObject({ module: 'education', entry: 0, field: 'school' });
    expect(third.focus!.nonce).not.toBe(second.focus!.nonce);
  });

  it('opening another module drops a pending focus', () => {
    const jumped = navReduce(INITIAL_NAV, { type: 'jump', target: { module: 'basics', field: 'phone' } });
    expect(navReduce(jumped, { type: 'module', module: null }).focus).toBeNull();
  });

  it('onboarding step and settings page are set directly', () => {
    expect(navReduce(INITIAL_NAV, { type: 'onboardingStep', step: 2 }).onboardingStep).toBe(2);
    expect(navReduce(INITIAL_NAV, { type: 'settingsPage', page: 'privacy' }).settingsPage).toBe('privacy');
  });

  it('reset returns to the initial state', () => {
    const busy = at({ tab: 'settings', module: 'work', settingsPage: 'privacy', onboardingStep: 2 });
    expect(navReduce(busy, { type: 'reset' })).toEqual(INITIAL_NAV);
  });
});

describe('navReduce: the fill browser', () => {
  const paste = { url: 'https://jobs.example.com/a', demo: false, recentId: 'p1', source: 'paste' as const };

  it('starts with no browser', () => {
    expect(INITIAL_NAV.browser).toBeNull();
  });

  it('openBrowser shows it, from Home or from onboarding', () => {
    const s = navReduce(INITIAL_NAV, { type: 'openBrowser', target: paste });
    expect(s.browser).toEqual({ target: { url: 'https://jobs.example.com/a', demo: false, recentId: 'p1' }, hidden: false, returnTo: 'home' });
    const demo = navReduce(at({ onboardingStep: 2 }), {
      type: 'openBrowser',
      target: { url: 'https://appassets.androidplatform.net/demo/form.html', demo: true, source: 'demo-onboarding' },
    });
    expect(demo.browser).toMatchObject({ hidden: false, returnTo: 'onboarding', target: { demo: true } });
    expect(demo.onboardingStep).toBe(2);
  });

  it('hideBrowser keeps the session and goes to the 简历 tab root; showBrowser brings it back', () => {
    const open = navReduce(at({ module: 'basics' }), { type: 'openBrowser', target: paste });
    const hidden = navReduce(open, { type: 'hideBrowser' });
    expect(hidden).toMatchObject({ tab: 'resume', module: null, browser: { hidden: true, target: { url: paste.url } } });
    const shown = navReduce(navReduce(hidden, { type: 'tab', tab: 'settings' }), { type: 'showBrowser' });
    expect(shown).toMatchObject({ tab: 'settings', browser: { hidden: false } });
  });

  it('closeBrowser drops it; with nothing open, hide/show/close change nothing', () => {
    const open = navReduce(INITIAL_NAV, { type: 'openBrowser', target: paste });
    expect(navReduce(open, { type: 'closeBrowser' }).browser).toBeNull();
    expect(navReduce(INITIAL_NAV, { type: 'hideBrowser' })).toBe(INITIAL_NAV);
    expect(navReduce(INITIAL_NAV, { type: 'showBrowser' })).toBe(INITIAL_NAV);
    expect(navReduce(INITIAL_NAV, { type: 'closeBrowser' })).toBe(INITIAL_NAV);
  });

  it('opening another link replaces the target; reset clears the browser', () => {
    const open = navReduce(INITIAL_NAV, { type: 'openBrowser', target: paste });
    const next = navReduce(navReduce(open, { type: 'hideBrowser' }), {
      type: 'openBrowser',
      target: { url: 'https://careers.example.com/', demo: false, source: 'recent', recentId: 'p2' },
    });
    expect(next.browser).toMatchObject({ hidden: false, target: { url: 'https://careers.example.com/', recentId: 'p2' } });
    expect(navReduce(next, { type: 'reset' })).toEqual(INITIAL_NAV);
  });
});

describe('backFrom', () => {
  it('module → list; privacy → settings root; settings/resume root → home; home → null', () => {
    expect(backFrom(at({ tab: 'resume', module: 'basics' }), false)).toMatchObject({ tab: 'resume', module: null });
    expect(backFrom(at({ tab: 'settings', settingsPage: 'privacy' }), false)).toMatchObject({ tab: 'settings', settingsPage: 'root' });
    expect(backFrom(at({ tab: 'settings' }), false)).toMatchObject({ tab: 'home' });
    expect(backFrom(at({ tab: 'resume' }), false)).toMatchObject({ tab: 'home' });
    expect(backFrom(at({ tab: 'home' }), false)).toBeNull();
  });

  it('going home keeps the other tabs’ sub-state', () => {
    // On the settings root with a module open on the 简历 tab: home, and the module is still there to come back to.
    expect(backFrom(at({ tab: 'settings', module: 'basics' }), false)).toMatchObject({ tab: 'home', module: 'basics' });
    // A module open on 简历 does not catch the back key while another tab is shown.
    expect(backFrom(at({ tab: 'home', module: 'basics' }), false)).toBeNull();
  });

  it('during onboarding: step 2 → step 1; step 1 → null', () => {
    expect(backFrom(at({ onboardingStep: 2, tab: 'resume', module: 'basics' }), true)).toMatchObject({ onboardingStep: 1, module: 'basics' });
    expect(backFrom(at({ onboardingStep: 1, tab: 'resume', module: 'basics' }), true)).toBeNull();
  });
});

describe('navReduce: the 网申 tab', () => {
  it('openApplication / closeApplication', () => {
    const open = navReduce(INITIAL_NAV, { type: 'openApplication', id: 'rec-1' });
    expect(open).toMatchObject({ tab: 'applications', tracker: { applicationId: 'rec-1', filter: 'all' } });
    const closed = navReduce(open, { type: 'closeApplication' });
    expect(closed).toMatchObject({ tab: 'applications', tracker: { applicationId: null } });
    expect(navReduce(closed, { type: 'closeApplication' })).toBe(closed);
  });

  it('back order: detail, list, home', () => {
    const detail = navReduce(INITIAL_NAV, { type: 'openApplication', id: 'rec-1' });
    const list = backFrom(detail, false)!;
    expect(list).toMatchObject({ tab: 'applications', tracker: { applicationId: null } });
    const home = backFrom(list, false)!;
    expect(home).toMatchObject({ tab: 'home' });
    expect(backFrom(home, false)).toBeNull();
  });

  it('tapping 网申 returns to the list', () => {
    const detail = navReduce(INITIAL_NAV, { type: 'openApplication', id: 'rec-1' });
    expect(navReduce(detail, { type: 'tab', tab: 'applications' }).tracker.applicationId).toBeNull();
    // From another tab, the detail is still there to come back to.
    const away = navReduce(detail, { type: 'tab', tab: 'home' });
    expect(navReduce(away, { type: 'tab', tab: 'applications' }).tracker.applicationId).toBe('rec-1');
  });

  it('tracker filter, query and sort survive tab switches and reset clears them', () => {
    let s = navReduce(INITIAL_NAV, { type: 'tab', tab: 'applications' });
    s = navReduce(s, { type: 'tracker', patch: { filter: 'filling', query: '示例', sort: 'deadline' } });
    s = navReduce(navReduce(s, { type: 'tab', tab: 'settings' }), { type: 'tab', tab: 'applications' });
    expect(s.tracker).toEqual({ applicationId: null, filter: 'filling', query: '示例', sort: 'deadline' });
    // Opening a record keeps the list's filter for the way back.
    expect(navReduce(s, { type: 'openApplication', id: 'r' }).tracker).toMatchObject({ filter: 'filling', query: '示例' });
    expect(navReduce(s, { type: 'reset' })).toEqual(INITIAL_NAV);
  });

  it('pasteFocus nonce', () => {
    const away = at({ tab: 'settings' });
    const first = navReduce(away, { type: 'pasteFocus' });
    expect(first.tab).toBe('home');
    expect(typeof first.pasteFocus).toBe('number');
    const second = navReduce(first, { type: 'pasteFocus' });
    expect(second.pasteFocus).not.toBe(first.pasteFocus);
    expect(navReduce(second, { type: 'pasteFocusDone' }).pasteFocus).toBeNull();
    const done = navReduce(second, { type: 'pasteFocusDone' });
    expect(navReduce(done, { type: 'pasteFocusDone' })).toBe(done);
  });

  it('tracker and reminder sources return to the tracker', () => {
    const url = 'https://jobs.example.com/a';
    const ret = (source: BrowserSource, returnTo?: 'home' | 'onboarding' | 'tracker') =>
      navReduce(INITIAL_NAV, { type: 'openBrowser', target: { url, demo: false, recentId: 'r', source, ...(returnTo ? { returnTo } : {}) } }).browser!.returnTo;
    expect(ret('tracker')).toBe('tracker');
    expect(ret('reminder')).toBe('tracker');
    expect(ret('shortcut')).toBe('home');
    expect(ret('view')).toBe('home');
    expect(ret('share')).toBe('home');
    expect(ret('clipboard')).toBe('home');
    expect(ret('demo-onboarding')).toBe('onboarding');
    // App passes onboarding for anything opened while onboarding shows.
    expect(ret('view', 'onboarding')).toBe('onboarding');
    // The stored target never carries the routing fields.
    const s = navReduce(INITIAL_NAV, { type: 'openBrowser', target: { url, demo: false, recentId: 'r', source: 'view', returnTo: 'onboarding' } });
    expect(s.browser!.target).toEqual({ url, demo: false, recentId: 'r' });
  });

  it('closing a page opened from the tracker goes back to the applications tab with the detail kept', () => {
    const detail = navReduce(INITIAL_NAV, { type: 'openApplication', id: 'rec-1' });
    const open = navReduce(detail, { type: 'openBrowser', target: { url: 'https://jobs.example.com/a', demo: false, recentId: 'rec-1', source: 'tracker' } });
    const hidden = navReduce(open, { type: 'hideBrowser' });
    const closed = navReduce(hidden, { type: 'closeBrowser' });
    expect(closed).toMatchObject({ tab: 'applications', browser: null, tracker: { applicationId: 'rec-1' } });
  });
});
