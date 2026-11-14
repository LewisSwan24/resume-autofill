// Mobile app navigation: which tab is shown, what each tab has open, jumps to a field, and the back key.
import { describe, expect, it } from 'vitest';
import { INITIAL_NAV, backFrom, navReduce, type NavState } from '../../../mobile/app/src/navigation';

const at = (patch: Partial<NavState>): NavState => ({ ...INITIAL_NAV, ...patch });

describe('navReduce', () => {
  it('starts on home', () => {
    expect(INITIAL_NAV).toEqual({ tab: 'home', module: null, focus: null, settingsPage: 'root', onboardingStep: 1 });
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
