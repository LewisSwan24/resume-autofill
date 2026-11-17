import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import {
  clearWizardSession,
  handleWizardNavigation,
  loadWizardSession,
  recordWizardStep,
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
});
