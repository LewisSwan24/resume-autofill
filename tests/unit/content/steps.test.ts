import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createStepHandlers } from '../../../src/content/steps';

describe('content step handlers', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(5_000);
  });
  afterEach(() => {
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('describes the step: where it is, what moving on takes, and what is in the way', () => {
    document.body.innerHTML = '<input name="first" required><button>Back</button><button>下一步</button>';
    const steps = createStepHandlers(document, { adapterStep: () => null });
    expect(steps.stepState()).toEqual({
      url: document.location.href,
      fingerprint: expect.stringMatching(/^fields:/),
      action: 'next',
      blocker: 'needs_you',
      userInputAt: 0,
    });
  });

  it('answers first and presses Next a moment later, so a page that unloads still gets its answer out', () => {
    document.body.innerHTML = '<input name="first" value="x"><button id="next">Next</button>';
    const clicked = vi.fn();
    document.getElementById('next')!.addEventListener('click', clicked);
    const steps = createStepHandlers(document, { adapterStep: () => null });
    expect(steps.pressNext()).toEqual({ pressed: true });
    expect(clicked).not.toHaveBeenCalled();
    vi.runAllTimers();
    expect(clicked).toHaveBeenCalledTimes(1);
  });

  it('never presses a send button, even when it is the only button', () => {
    document.body.innerHTML = '<form><input name="a" value="x"><button id="send">Submit application</button></form>';
    const sent = vi.fn((e: Event) => e.preventDefault());
    document.querySelector('form')!.addEventListener('submit', sent);
    document.getElementById('send')!.addEventListener('click', sent);
    const steps = createStepHandlers(document, { adapterStep: () => null });
    expect(steps.pressNext()).toEqual({ pressed: false, reason: 'final_step' });
    vi.runAllTimers();
    expect(sent).not.toHaveBeenCalled();
  });

  it('does not press while something on the page waits for the user', () => {
    document.body.innerHTML = '<input name="a" required><button id="next">Next</button>';
    const clicked = vi.fn();
    document.getElementById('next')!.addEventListener('click', clicked);
    const steps = createStepHandlers(document, { adapterStep: () => null });
    expect(steps.pressNext()).toEqual({ pressed: false, reason: 'needs_you' });
    vi.runAllTimers();
    expect(clicked).not.toHaveBeenCalled();
  });

  it('uses the button the site adapter names', () => {
    document.body.innerHTML = '<button>Next</button><button data-automation-id="pageFooterNextButton">Submit</button>';
    const steps = createStepHandlers(document, {
      adapterStep: () => 'Review',
      adapterNext: () => '[data-automation-id="pageFooterNextButton"]',
    });
    expect(steps.stepState()).toMatchObject({ fingerprint: 'step:Review', action: 'final' });
  });

  it('notes when the user presses a key or the pointer on the page, but not on the extension button', () => {
    document.body.innerHTML = '<input id="a"><raf-fab></raf-fab>';
    const steps = createStepHandlers(document, { adapterStep: () => null, isTrusted: () => true });
    document.querySelector('raf-fab')!.dispatchEvent(new Event('pointerdown', { bubbles: true, composed: true }));
    expect(steps.stepState().userInputAt).toBe(0);
    vi.setSystemTime(6_000);
    document.getElementById('a')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    expect(steps.stepState().userInputAt).toBe(6_000);
    steps.stop();
    vi.setSystemTime(7_000);
    document.getElementById('a')!.dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(steps.stepState().userInputAt).toBe(6_000);
  });

  it('ignores events the page or the extension made up', () => {
    document.body.innerHTML = '<input id="a">';
    const steps = createStepHandlers(document, { adapterStep: () => null });
    document.getElementById('a')!.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true }));
    expect(steps.stepState().userInputAt).toBe(0);
  });
});
