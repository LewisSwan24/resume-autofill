// A step of a form may sit in a frame: a careers page that embeds its ATS, a form drawn in an iframe. Each frame says
// what it shows; together they say what the tab shows, as cautiously as one page would.
import { describe, expect, it } from 'vitest';
import type { StepState } from '../../../src/background/autoAdvance';
import { mergeStepStates, readTabStep } from '../../../src/background/frameSteps';

const state = (over: Partial<StepState> = {}): StepState => ({
  url: 'https://careers.example.com/apply',
  fingerprint: 'fields:0:5381',
  action: 'none',
  blocker: null,
  userInputAt: 0,
  ...over,
});
const at = (frameId: number, over: Partial<StepState> = {}) => ({ frameId, state: state(over) });

describe('mergeStepStates', () => {
  it('is the top frame alone when there is nothing else', () => {
    const top = state({ action: 'next', fingerprint: 'fields:2:abc' });
    expect(mergeStepStates([{ frameId: 0, state: top }])).toEqual({ state: top, pressIn: 0 });
  });

  it('presses Next in the one frame that has it, and reports the tab by its top address', () => {
    const merged = mergeStepStates([at(0), at(7, { url: 'https://ats.example.net/form', action: 'next', fingerprint: 'fields:3:x' })]);
    expect(merged?.pressIn).toBe(7);
    expect(merged?.state).toMatchObject({ url: 'https://careers.example.com/apply', action: 'next' });
  });

  it('stops when two frames each have a Next, or one has Next and another a button that sends', () => {
    expect(mergeStepStates([at(0, { action: 'next' }), at(3, { action: 'next' })])).toEqual({ state: expect.objectContaining({ action: 'ambiguous' }), pressIn: null });
    expect(mergeStepStates([at(0, { action: 'final' }), at(3, { action: 'next' })])?.state.action).toBe('ambiguous');
    expect(mergeStepStates([at(0), at(3, { action: 'ambiguous' })])?.state.action).toBe('ambiguous');
  });

  it('is the last step when only a send button is left, in any frame', () => {
    expect(mergeStepStates([at(0), at(3, { action: 'final' })])).toEqual({ state: expect.objectContaining({ action: 'final' }), pressIn: null });
  });

  it('waits for the user when the one Next is switched off', () => {
    expect(mergeStepStates([at(0), at(3, { action: 'disabled' })])?.state.action).toBe('disabled');
  });

  it('holds when any frame has a captcha or a question left unanswered, a captcha first', () => {
    expect(mergeStepStates([at(0, { action: 'next' }), at(3, { blocker: 'needs_you' })])?.state.blocker).toBe('needs_you');
    expect(mergeStepStates([at(0, { blocker: 'needs_you' }), at(3, { blocker: 'verification' })])?.state.blocker).toBe('verification');
  });

  it('tells steps apart by the fields of every frame that shows some, not by frames with none', () => {
    const one = mergeStepStates([at(0, { fingerprint: 'fields:0:5381' }), at(4, { fingerprint: 'fields:2:aaa' })])!.state.fingerprint;
    const two = mergeStepStates([at(0, { fingerprint: 'fields:0:5381' }), at(4, { fingerprint: 'fields:3:bbb' })])!.state.fingerprint;
    // An ad frame with no fields coming and going is no new step.
    const withAd = mergeStepStates([at(0, { fingerprint: 'fields:0:5381' }), at(4, { fingerprint: 'fields:2:aaa' }), at(9, { fingerprint: 'fields:0:5381' })])!.state.fingerprint;
    expect(one).not.toBe(two);
    expect(withAd).toBe(one);
    // A site adapter's step name stays as it is.
    expect(mergeStepStates([at(0, { fingerprint: 'step:review' })])!.state.fingerprint).toBe('step:review');
  });

  it('takes the latest touch of the user in any frame', () => {
    expect(mergeStepStates([at(0, { userInputAt: 5 }), at(2, { userInputAt: 9 })])?.state.userInputAt).toBe(9);
  });

  it('knows nothing until the top frame answers', () => {
    expect(mergeStepStates([at(3, { action: 'next' })])).toBeNull();
    expect(mergeStepStates([])).toBeNull();
  });
});

describe('readTabStep', () => {
  it('asks every frame, leaves out one that does not answer or answers nonsense, and merges the rest', async () => {
    const answers: Record<number, unknown> = {
      0: state(),
      5: state({ action: 'next', fingerprint: 'fields:1:a' }),
      6: { nonsense: true },
    };
    const asked: number[] = [];
    const merged = await readTabStep(9, {
      listFrameIds: async () => [0, 5, 6, 8],
      ask: async (tabId, frameId) => {
        expect(tabId).toBe(9);
        asked.push(frameId);
        if (frameId === 8) throw new Error('no content script');
        return answers[frameId];
      },
    });
    expect(asked.sort()).toEqual([0, 5, 6, 8]);
    expect(merged).toMatchObject({ pressIn: 5, state: { action: 'next', fingerprint: 'fields:1:a' } });
  });
});
