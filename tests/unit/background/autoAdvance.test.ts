import { describe, expect, it, vi } from 'vitest';
import {
  runAutoAdvance,
  stopAutoAdvance,
  type AdvanceDeps,
  type AdvanceState,
  type StepState,
} from '../../../src/background/autoAdvance';

const ORIGIN = 'https://jobs.example.test';
const step = (n: number, over: Partial<StepState> = {}): StepState => ({
  url: `${ORIGIN}/apply/${n}`,
  fingerprint: `step:${n}`,
  action: 'next',
  blocker: null,
  userInputAt: 0,
  ...over,
});

/**
 * A fake site of numbered steps. Pressing Next moves to the next one; the last step only has a send button.
 * `pages[i]` overrides what step i+1 looks like.
 */
function site(pages: Array<Partial<StepState>>, opts: { stuckAt?: number; leaveAt?: number } = {}) {
  let clock = 1_000;
  let at = 1;
  const published: AdvanceState[] = [];
  const pressed: number[] = [];
  const filled: number[] = [];
  const fillOrigins: string[] = [];
  let alive = true;
  const deps: AdvanceDeps = {
    readStep: vi.fn(async () => step(at, pages[at - 1])),
    pressNext: vi.fn(async () => {
      pressed.push(at);
      if (opts.leaveAt === at) alive = false;
      else if (opts.stuckAt !== at) at++;
      return { pressed: true };
    }),
    fill: vi.fn(async (_tab, origin) => {
      fillOrigins.push(origin);
      filled.push(at);
      return { ok: true };
    }),
    sessionOrigin: vi.fn(async () => (alive ? ORIGIN : null)),
    publish: vi.fn(async (_tab, state) => {
      published.push(state);
    }),
    now: () => clock,
    sleep: async (ms) => {
      clock += ms;
    },
    pollMs: 400,
    waitMs: 10_000,
    settleMs: 600,
    maxSteps: 15,
  };
  return { deps, published, pressed, filled, fillOrigins, setClock: (t: number) => (clock = t), now: () => clock };
}

describe('runAutoAdvance', () => {
  it('presses Next and fills each new step until the last one, which it leaves for the user', async () => {
    const s = site([{}, {}, { action: 'final' }]);
    const result = await runAutoAdvance(7, s.deps);
    expect(result).toEqual({ running: false, steps: 2, stopReason: 'final_step' });
    expect(s.pressed).toEqual([1, 2]);
    expect(s.filled).toEqual([2, 3]);
    expect(s.published[0]).toEqual({ running: true, steps: 0 });
    expect(s.published.at(-1)).toEqual(result);
    expect(s.fillOrigins, 'every fill is tied to the site the run started on').toEqual([ORIGIN, ORIGIN]);
  });

  it('never fills a step that turned up on another site, even before the session notices', async () => {
    const s = site([{}, { url: 'https://elsewhere.example.test/form' }]);
    expect(await runAutoAdvance(7, s.deps)).toEqual({ running: false, steps: 0, stopReason: 'left_site' });
    expect(s.filled).toEqual([]);
  });

  it('stops as having left the site when the fill finds the tab somewhere else', async () => {
    const s = site([{}, {}]);
    s.deps.fill = vi.fn(async () => ({ ok: false, error: 'origin_changed' }));
    expect((await runAutoAdvance(7, s.deps)).stopReason).toBe('left_site');
  });

  it.each([
    ['none', 'no_next'],
    ['ambiguous', 'ambiguous'],
    ['disabled', 'needs_you'],
  ] as const)('stops without pressing anything when the page has %s', async (action, reason) => {
    const s = site([{ action }]);
    expect((await runAutoAdvance(7, s.deps)).stopReason).toBe(reason);
    expect(s.pressed).toEqual([]);
  });

  it.each(['needs_you', 'verification'] as const)('stops on a step that is waiting for the user (%s)', async (blocker) => {
    const s = site([{}, { blocker }, {}]);
    const result = await runAutoAdvance(7, s.deps);
    expect(result).toEqual({ running: false, steps: 1, stopReason: blocker });
    expect(s.pressed).toEqual([1]);
  });

  it('stops when pressing Next does not change the step within the wait', async () => {
    const s = site([{}, {}], { stuckAt: 1 });
    const start = s.now();
    const result = await runAutoAdvance(7, s.deps);
    expect(result.stopReason).toBe('not_advanced');
    expect(s.filled).toEqual([]);
    expect(s.now() - start).toBeGreaterThanOrEqual(10_000);
  });

  it('calls a step that stays put and shows a page error "needs you"', async () => {
    const s = site([{}], { stuckAt: 1 });
    let calls = 0;
    s.deps.readStep = vi.fn(async () => (++calls === 1 ? step(1) : step(1, { blocker: 'needs_you' })));
    expect((await runAutoAdvance(7, s.deps)).stopReason).toBe('needs_you');
  });

  it('treats a page reload under way as not there yet, and goes on once the new step answers', async () => {
    const s = site([{}, { action: 'final' }]);
    const real = s.deps.readStep;
    let calls = 0;
    s.deps.readStep = vi.fn(async (tab) => (++calls === 2 ? null : real(tab)));
    expect(await runAutoAdvance(7, s.deps)).toEqual({ running: false, steps: 1, stopReason: 'final_step' });
  });

  it('stops when the tab leaves the site', async () => {
    const s = site([{}, {}], { leaveAt: 1 });
    expect((await runAutoAdvance(7, s.deps)).stopReason).toBe('left_site');
    expect(s.filled).toEqual([]);
  });

  it('stops when the user has typed or clicked on the page since the last step', async () => {
    const s = site([{}, { userInputAt: 999_999_999 }, {}]);
    const result = await runAutoAdvance(7, s.deps);
    expect(result).toEqual({ running: false, steps: 1, stopReason: 'user_took_over' });
  });

  it('ignores what the user did before starting', async () => {
    const s = site([{ userInputAt: 500 }, { action: 'final' }]);
    expect((await runAutoAdvance(7, s.deps)).stopReason).toBe('final_step');
  });

  it('stops at the step limit', async () => {
    const s = site([]);
    s.deps.maxSteps = 3;
    expect(await runAutoAdvance(7, s.deps)).toEqual({ running: false, steps: 3, stopReason: 'step_limit' });
    expect(s.pressed).toHaveLength(3);
  });

  it('stops at a preview when the user asked to preview before every fill', async () => {
    const s = site([{}, {}, {}]);
    s.deps.fill = vi.fn(async () => ({ ok: true, preview: true }));
    expect(await runAutoAdvance(7, s.deps)).toEqual({ running: false, steps: 1, stopReason: 'preview' });
  });

  it('stops when a fill fails, and says so when the vault locked', async () => {
    const s = site([{}, {}]);
    s.deps.fill = vi.fn(async () => ({ ok: false, error: 'vault_locked' }));
    expect((await runAutoAdvance(7, s.deps)).stopReason).toBe('vault_locked');
    const t = site([{}, {}]);
    t.deps.fill = vi.fn(async () => ({ ok: false, error: 'busy' }));
    expect((await runAutoAdvance(8, t.deps)).stopReason).toBe('fill_failed');
  });

  it('treats a step with nothing the resume can fill as filled, and goes on to check it', async () => {
    const s = site([{}, { blocker: 'needs_you' }]);
    s.deps.fill = vi.fn(async () => ({ ok: false, error: 'no_frames' }));
    expect(await runAutoAdvance(7, s.deps)).toEqual({ running: false, steps: 1, stopReason: 'needs_you' });
    const t = site([{}, {}, { action: 'final' }]);
    t.deps.fill = vi.fn(async () => ({ ok: false, error: 'no_frames' }));
    expect(await runAutoAdvance(8, t.deps)).toEqual({ running: false, steps: 2, stopReason: 'final_step' });
  });

  it('stops when the page refuses the press', async () => {
    const s = site([{}, {}]);
    s.deps.pressNext = vi.fn(async () => ({ pressed: false, reason: 'ambiguous' as const }));
    expect((await runAutoAdvance(7, s.deps)).stopReason).toBe('ambiguous');
  });

  it('stops when asked to, between steps', async () => {
    const s = site([]);
    s.deps.fill = vi.fn(async () => {
      stopAutoAdvance(9);
      return { ok: true };
    });
    expect(await runAutoAdvance(9, s.deps)).toEqual({ running: false, steps: 1, stopReason: 'stopped' });
  });

  it('runs once per tab: a second start while one runs changes nothing', async () => {
    const s = site([{}, {}, { action: 'final' }]);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const fill = s.deps.fill;
    s.deps.fill = vi.fn(async (tab, origin) => {
      await gate;
      return fill(tab, origin);
    });
    const first = runAutoAdvance(11, s.deps);
    await Promise.resolve();
    const second = await runAutoAdvance(11, s.deps);
    expect(second).toEqual({ running: true, steps: 0 });
    release();
    expect((await first).stopReason).toBe('final_step');
    expect(stopAutoAdvance(11)).toBe(false);
  });
});
