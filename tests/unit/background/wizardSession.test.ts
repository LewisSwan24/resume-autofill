import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  clearWizardSession,
  handleWizardNavigation,
  loadWizardSession,
  recordWizardStep,
  setWizardAdvance,
} from '../../../src/background/wizardSession';

describe('Cross-page multi-step wizard session tracker', () => {
  beforeEach(() => {
    fakeBrowser.reset();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.UTC(2026, 10, 1));
  });

  it('tracks multi-step progression on same origin and clears cleanly across origins', async () => {
    await recordWizardStep(42, 'https://jobs.ashbyhq.com/acme/step-1', { id: 'r1', title: 'Backend' });
    const s1 = await loadWizardSession(42);
    expect(s1?.stepCount).toBe(1);

    // Same-origin navigation preserves wizard continuity across page reload.
    const preserved = await handleWizardNavigation(42, 'https://jobs.ashbyhq.com/acme/step-2');
    expect(preserved?.origin).toBe('https://jobs.ashbyhq.com');

    await recordWizardStep(42, 'https://jobs.ashbyhq.com/acme/step-2', { id: 'r1', title: 'Backend' });
    const s2 = await loadWizardSession(42);
    expect(s2?.stepCount).toBe(2);

    // Navigating to another origin invalidates session state cleanly.
    const cleared = await handleWizardNavigation(42, 'https://unrelated.example.com/');
    expect(cleared).toBeNull();
    expect(await loadWizardSession(42)).toBeNull();

    await recordWizardStep(42, 'https://jobs.ashbyhq.com/acme/step-1', { id: 'r1', title: 'Backend' });
    await clearWizardSession(42);
    expect(await loadWizardSession(42)).toBeNull();
  });

  it('keeps the auto-advance state while the run goes on, and drops it for a new run', async () => {
    const r = { id: 'r1', title: 'Backend' };
    await recordWizardStep(42, 'https://jobs.ashbyhq.com/acme/step-1', r);
    const set = await setWizardAdvance(42, { running: true, steps: 0 });
    expect(set?.advance).toEqual({ running: true, steps: 0 });

    await handleWizardNavigation(42, 'https://jobs.ashbyhq.com/acme/step-2');
    const s2 = await recordWizardStep(42, 'https://jobs.ashbyhq.com/acme/step-2', r);
    expect(s2?.advance).toEqual({ running: true, steps: 0 });

    const other = await recordWizardStep(42, 'https://jobs.ashbyhq.com/acme/step-2', { id: 'r2', title: 'Data' });
    expect(other?.advance).toBeUndefined();
  });

  it('does not start a session just to hold auto-advance state', async () => {
    expect(await setWizardAdvance(43, { running: false, steps: 0, stopReason: 'left_site' })).toBeNull();
    expect(await loadWizardSession(43)).toBeNull();
  });
});
