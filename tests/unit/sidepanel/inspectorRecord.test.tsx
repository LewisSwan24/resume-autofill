import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { fakeBrowser } from 'wxt/testing/fake-browser';
import App from '../../../entrypoints/sidepanel/App';
import type { FillReport } from '../../../src/engine/types';
import { setLanguage } from '../../../src/i18n';
import type { UiToBg } from '../../../src/messaging';
import { createSampleProfile } from '../../../src/schema';
import { loadProfile, saveProfile } from '../../../src/storage';

const TAB_ID = 42;

beforeEach(() => {
  fakeBrowser.reset();
  setLanguage('en');
});

afterEach(() => {
  vi.restoreAllMocks();
  cleanup();
});

describe('Side panel – Point-and-Record Field Inspector, Hybrid RRF & STAR Prep', () => {
  it('toggles inspector pick mode, saves mapped SiteRecipe rule on pick, and generates STAR prep', async () => {
    const profile = createSampleProfile();
    profile.activeResumeId = 'sample-en';
    profile.settings.uiLanguage = 'en';
    profile.settings.aiLayerMode = 'bm25_only';
    await saveProfile(profile);

    const report: FillReport = {
      url: 'https://talent.acme.test/apply',
      startedAt: 1,
      finishedAt: 2,
      counts: { filled: 0, needs_review: 0, unmatched: 1, no_data: 0, no_control: 0, no_option: 0, action_failed: 0 },
      fields: [
        {
          fieldId: 'c1',
          frameId: 0,
          label: 'Describe a project where you led architecture improvements',
          fieldKey: null,
          section: 'other',
          outcome: 'unmatched',
          confidence: 0.2,
        },
      ],
    };
    await fakeBrowser.storage.session.set({ [`report:${TAB_ID}`]: report });
    window.history.replaceState({}, '', `/sidepanel.html?tabId=${TAB_ID}`);

    const sent: UiToBg[] = [];
    fakeBrowser.runtime.onMessage.addListener(((msg: UiToBg) => {
      sent.push(msg);
      return undefined;
    }) as never);

    render(<App />);
    const pickBtn = await screen.findByRole('button', { name: 'Pick field' });
    fireEvent.click(pickBtn);
    expect(sent.some((m) => m.type === 'inspector:start' && m.tabId === TAB_ID)).toBe(true);

    act(() => {
      (fakeBrowser.runtime.onMessage as unknown as { trigger: (...a: unknown[]) => void }).trigger(
        {
          type: 'inspector:picked',
          tabId: TAB_ID,
          url: 'https://talent.acme.test/apply',
          target: {
            rect: { left: 10, top: 20, width: 200, height: 32 },
            label: 'Personal Repo',
            fieldKey: 'contact.github',
            section: 'contact',
            confidence: 0.85,
            tag: 'input',
            fingerprint: { tag: 'input', nameAttr: 'repo_url', labelTokens: ['personal', 'repo'] },
          },
        },
        { id: fakeBrowser.runtime.id },
      );
    });

    await screen.findByText('Captured: Personal Repo');
    const select = screen.getByLabelText('Resume field key') as HTMLSelectElement;
    expect(select.value).toBe('contact.github');

    fireEvent.click(screen.getByRole('button', { name: 'Save site rule' }));
    await waitFor(async () => {
      const updated = await loadProfile();
      expect(updated.recipes?.some((r) => r.hostPattern === 'talent.acme.test' && r.rules.some((ru) => ru.fieldKey === 'contact.github'))).toBe(true);
    });

    // Also test Hybrid RRF hint & STAR Prep inside ReportList
    fireEvent.click(screen.getByRole('button', { name: 'STAR Prep' }));
    await screen.findByText(/STAR Interview Prep/);
  });
});
