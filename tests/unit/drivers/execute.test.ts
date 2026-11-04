import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { registerDriver, unregisterDriver } from '../../../src/drivers/registry';
import { executeStep, type FillStep } from '../../../src/drivers/execute';
import type { Driver, DriverContext, FillResult } from '../../../src/drivers/types';
import type { Control } from '../../../src/engine/types';
import { choice, firstControl } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

const el = document.createElement('div');
beforeEach(() => {
  document.body.append(el);
});
const control: Control = { id: 'c1', el, kind: 'text', lib: 'native' };

const step = (over: Partial<FillStep> = {}): FillStep => ({
  fieldId: 'c1',
  fieldKey: 'basics.email',
  intent: { kind: 'text', text: 'a@b.co' },
  confidence: 0.9,
  label: 'Email',
  ...over,
});

function scripted(results: Array<FillResult | Error | 'hang'>, observedRead: string | null = 'READ'): Driver & { calls: DriverContext[] } {
  const calls: DriverContext[] = [];
  return {
    id: 'fake',
    lib: 'native',
    kinds: ['text'],
    match: () => true,
    calls,
    fill: async (_c, _i, ctx) => {
      calls.push(ctx);
      const next = results[calls.length - 1] ?? { ok: false, observed: null };
      if (next === 'hang') return new Promise<FillResult>(() => undefined);
      if (next instanceof Error) throw next;
      return next;
    },
    read: () => observedRead,
  };
}

const run = (d: Driver, s = step(), timeoutMs?: number, graceMs = 20) =>
  executeStep(s, control, document, { resolveDriver: () => d, graceMs, ...(timeoutMs ? { timeoutMs } : {}) });

describe('executeStep', () => {
  // Seen on a real page: text typed into a custom select is wiped by the widget a moment later.
  it('does not report filled for a control that is no longer on the page', async () => {
    const gone = document.createElement('input');
    const r = await executeStep(step(), { ...control, el: gone }, document, {
      resolveDriver: () => scripted([{ ok: true, observed: 'a@b.co' }], 'a@b.co'),
    });
    expect(r.outcome).toBe('action_failed');
  });

  it('a file box may leave the page once it has its file', async () => {
    const gone = document.createElement('input');
    const file = { kind: 'file' as const, file: { name: 'cv.pdf', type: 'application/pdf', dataUrl: 'data:,' } };
    const r = await executeStep(step({ intent: file }), { ...control, kind: 'file', el: gone }, document, {
      resolveDriver: () => scripted([{ ok: true, observed: 'cv.pdf' }], 'cv.pdf'),
    });
    expect(r.outcome).toBe('filled');
  });

  it('does not report filled when the driver says ok but the page reads back empty', async () => {
    const r = await run(scripted([{ ok: true, observed: 'x' }], ''));
    expect(r.outcome).toBe('action_failed');
    expect(r.observed).toBe('');
  });

  it('keeps filled when read() has no answer but the driver observed the value', async () => {
    const r = await run(scripted([{ ok: true, observed: 'x' }], null));
    expect(r.outcome).toBe('filled');
    expect(r.observed).toBe('x');
  });

  it('does not report filled when nothing at all could be read back', async () => {
    const r = await run(scripted([{ ok: true, observed: null }], null));
    expect(r.outcome).toBe('action_failed');
  });

  it('accepts an empty read-back for a checkbox, where it means unchecked', async () => {
    const r = await run(scripted([{ ok: true, observed: '' }], ''), step({ intent: { kind: 'check', checked: false } }));
    expect(r.outcome).toBe('filled');
  });

  it('maps ok → filled with value, observed (driver.read), source, section and confidence', async () => {
    const d = scripted([{ ok: true, observed: 'x' }]);
    const r = await run(d, step({ source: 'basics.email', section: 'basics' }));
    expect(r).toEqual({
      fieldId: 'c1',
      label: 'Email',
      fieldKey: 'basics.email',
      section: 'basics',
      outcome: 'filled',
      confidence: 0.9,
      value: 'a@b.co',
      observed: 'READ',
      source: 'basics.email',
    });
    expect(d.calls).toHaveLength(1);
    expect(d.calls[0]).toMatchObject({ attempt: 1, timeoutMs: 4000 });
    expect(d.calls[0]!.doc).toBe(document);
  });

  it('retries once with attempt 2 after a plain failure and reports filled when it works', async () => {
    const d = scripted([{ ok: false, observed: null }, { ok: true, observed: 'x' }]);
    const r = await run(d);
    expect(r.outcome).toBe('filled');
    expect(d.calls.map((c) => c.attempt)).toEqual([1, 2]);
  });

  it('reports action_failed after two failures, and retries a thrown error', async () => {
    const d = scripted([new Error('boom'), { ok: false, observed: null, outcome: 'action_failed' }]);
    const r = await run(d);
    expect(r.outcome).toBe('action_failed');
    expect(d.calls).toHaveLength(2);
    expect(r.observed).toBe('READ');
  });

  it('does not retry terminal outcomes; needs_review carries candidate labels', async () => {
    const nr = scripted([{ ok: false, observed: null, outcome: 'needs_review', candidates: ['A', 'B'] }]);
    const r = await run(nr);
    expect(r.outcome).toBe('needs_review');
    expect(r.candidates).toEqual([{ label: 'A' }, { label: 'B' }]);
    expect(nr.calls).toHaveLength(1);

    const no = scripted([{ ok: false, observed: null, outcome: 'no_option' }]);
    expect((await run(no)).outcome).toBe('no_option');
    expect(no.calls).toHaveLength(1);
  });

  it('times out a hanging driver per attempt (action_failed after two attempts)', async () => {
    const d = scripted(['hang', 'hang']);
    const r = await run(d, step(), 40);
    expect(r.outcome).toBe('action_failed');
    expect(d.calls).toHaveLength(2);
  });

  it('never runs attempt 2 concurrently with a timed-out attempt 1 (I2)', async () => {
    const events: string[] = [];
    let running = 0;
    let maxRunning = 0;
    const slow: Driver = {
      id: 'slow',
      lib: 'native',
      kinds: ['text'],
      match: () => true,
      read: () => null,
      fill: async (_c, _i, ctx) => {
        events.push(`start${ctx.attempt}`);
        running++;
        maxRunning = Math.max(maxRunning, running);
        await new Promise((r) => setTimeout(r, 150)); // ignores the signal on purpose
        running--;
        events.push(`end${ctx.attempt}`);
        return { ok: false, observed: null };
      },
    };
    const r = await executeStep(step(), control, document, { resolveDriver: () => slow, timeoutMs: 50 });
    expect(r.outcome).toBe('action_failed');
    expect(events).toEqual(['start1', 'end1', 'start2', 'end2']);
    expect(maxRunning).toBe(1);
  });

  it('aborts ctx.signal on timeout, closes an open dropdown, then starts attempt 2', async () => {
    const events: string[] = [];
    const onKey = (e: KeyboardEvent) => events.push(`key:${e.key}`);
    document.addEventListener('keydown', onKey, true);
    const signals: AbortSignal[] = [];
    const d: Driver = {
      id: 'coop',
      lib: 'native',
      kinds: ['text'],
      match: () => true,
      read: () => null,
      fill: async (_c, _i, ctx) => {
        events.push(`start${ctx.attempt}`);
        const signal = ctx.signal!;
        signals.push(signal);
        if (ctx.attempt === 2) return { ok: true, observed: 'x' };
        await new Promise<void>((resolve) => signal.addEventListener('abort', () => resolve(), { once: true }));
        events.push('end1');
        return { ok: false, observed: null };
      },
    };
    try {
      const started = Date.now();
      const r = await executeStep(step(), control, document, { resolveDriver: () => d, timeoutMs: 40, graceMs: 1500 });
      expect(r.outcome).toBe('filled');
      expect(Date.now() - started).toBeLessThan(1000); // did not sit out the whole grace period
    } finally {
      document.removeEventListener('keydown', onKey, true);
    }
    expect(signals[0]!.aborted).toBe(true);
    expect(events).toEqual(['start1', 'end1', 'key:Escape', 'start2']);
  });

  it('accepts a late, verified success of a driver that ignored the abort (no second attempt)', async () => {
    const d: Driver = {
      id: 'late',
      lib: 'native',
      kinds: ['text'],
      match: () => true,
      read: () => 'x',
      fill: async () => {
        await new Promise((r) => setTimeout(r, 80));
        return { ok: true, observed: 'x' };
      },
    };
    const r = await executeStep(step(), control, document, { resolveDriver: () => d, timeoutMs: 30, graceMs: 1000 });
    expect(r.outcome).toBe('filled');
  });

  it('reports action_failed (never throws) when driver lookup or match() throws (I3)', async () => {
    const r = await executeStep(step(), control, document, {
      resolveDriver: () => {
        throw new Error('lookup boom');
      },
    });
    expect(r).toMatchObject({ fieldId: 'c1', outcome: 'action_failed', value: 'a@b.co' });

    const bad: Driver = {
      id: 'bad-match',
      lib: 'native',
      kinds: ['text'],
      match: () => {
        throw new Error('match boom');
      },
      fill: async () => ({ ok: true, observed: 'x' }),
      read: () => null,
    };
    registerDriver(bad);
    try {
      expect((await executeStep(step(), control, document)).outcome).toBe('action_failed'); // default getDriver
    } finally {
      unregisterDriver('bad-match');
    }
  });

  it('falls back to the result observed value when read() has nothing', async () => {
    const d = scripted([{ ok: true, observed: 'from result' }], null);
    expect((await run(d)).observed).toBe('from result');
  });

  it('returns no_control when no driver claims the control', async () => {
    const r = await executeStep(step(), control, document, { resolveDriver: () => null });
    expect(r.outcome).toBe('no_control');
  });

  it('derives value display text per intent kind', async () => {
    const d = scripted([{ ok: true, observed: null }]);
    const s = (intent: FillStep['intent']) => run(d, step({ intent }));
    expect((await s({ kind: 'check', checked: true })).value).toBe('true');
    expect((await s({ kind: 'file', file: { name: 'cv.pdf', type: 'x', dataUrl: 'data:,' } })).value).toBe('cv.pdf');
    expect((await s({ kind: 'date', display: '2020-09', year: 2020, month: 9 })).value).toBe('2020-09');
    expect((await s({ kind: 'cascade', display: 'A / B', path: ['A', 'B'] })).value).toBe('A / B');
  });

  describe('a page that rebuilds the field when it is left', () => {
    /** On blur the page swaps the input for a new element with the same id, holding `value`. */
    function rebuilding(value: (typed: string) => string, attrs = 'type="text"'): Control {
      const c = firstControl(`<input id="given" ${attrs}>`);
      c.el.addEventListener('blur', () => {
        const old = c.el as HTMLInputElement;
        const next = document.createElement('input');
        next.id = old.id;
        next.type = old.type;
        next.value = value(old.value);
        old.replaceWith(next);
      });
      return c;
    }
    const text = step({ intent: { kind: 'text', text: 'Zhiyuan' } });

    it('counts the value the new element holds, and follows it', async () => {
      const c = rebuilding((typed) => typed);
      const old = c.el;
      const r = await executeStep(text, c, document);
      expect(r).toMatchObject({ outcome: 'filled', observed: 'Zhiyuan' });
      expect(c.el).not.toBe(old);
      expect(c.el.isConnected).toBe(true);
    });

    it('fails when the new element came back empty', async () => {
      const r = await executeStep(text, rebuilding(() => ''), document);
      expect(r.outcome).toBe('action_failed');
    });

    it('fails when the new element holds something else', async () => {
      const r = await executeStep(text, rebuilding(() => 'Someone'), document);
      expect(r.outcome).toBe('action_failed');
    });

    it('does not take an element of another kind for it', async () => {
      const c = firstControl('<input id="given" type="text">');
      c.el.addEventListener('blur', () => {
        const next = document.createElement('div');
        next.id = 'given';
        next.textContent = 'Zhiyuan';
        c.el.replaceWith(next);
      });
      const r = await executeStep(text, c, document);
      expect(r.outcome).toBe('action_failed');
    });

    describe('with no id, or a new one, to go by', () => {
      /** On blur the page swaps the input for a new element in the same place. */
      function swapping(html: string, value: (typed: string) => string, newId?: string): Control {
        const c = firstControl(html);
        c.el.addEventListener('blur', () => {
          const old = c.el as HTMLInputElement;
          const next = document.createElement('input');
          next.type = old.type;
          if (newId) next.id = newId;
          next.value = value(old.value);
          old.replaceWith(next);
        });
        return c;
      }

      it('follows the one input left in its box', async () => {
        const c = swapping('<div><input type="text"></div><div><input type="text" value="Other"></div>', (typed) => typed);
        const old = c.el;
        const r = await executeStep(text, c, document);
        expect(r).toMatchObject({ outcome: 'filled', observed: 'Zhiyuan' });
        expect(c.el).not.toBe(old);
        expect(c.el.isConnected).toBe(true);
      });

      it('follows an input that came back under a new id', async () => {
        const c = swapping('<div><input id="field-1" type="text"></div><div><input type="text"></div>', (typed) => typed, 'field-2');
        const r = await executeStep(text, c, document);
        expect(r).toMatchObject({ outcome: 'filled', observed: 'Zhiyuan' });
      });

      it('follows by place among inputs that share a parent', async () => {
        const c = swapping('<form><input type="text"><input type="text" value="Other"></form>', (typed) => typed);
        const r = await executeStep(text, c, document);
        expect(r).toMatchObject({ outcome: 'filled', observed: 'Zhiyuan' });
      });

      it('fails when the input that took over came back empty', async () => {
        const c = swapping('<div><input type="text"></div><div><input type="text"></div>', () => '');
        const r = await executeStep(text, c, document);
        expect(r.outcome).toBe('action_failed');
      });

      it('does not take a neighbour for it when the row moved to the end of the form', async () => {
        const c = firstControl('<form><input type="text"><input type="email" id="e" value="me@example.com"><input type="text" id="other" value="Other"></form>');
        const form = c.el.parentElement!;
        c.el.addEventListener('blur', () => {
          const next = document.createElement('input');
          next.type = 'text';
          c.el.remove();
          form.append(next);
        });
        const r = await executeStep(text, c, document);
        expect(r.outcome).toBe('action_failed');
        expect((document.querySelector('#other') as HTMLInputElement).value).toBe('Other');
      });

      it('never writes into a neighbour on the second attempt', async () => {
        const c = firstControl('<form><input type="text" id="a"><input type="text" id="b" value="me@example.com"></form>');
        const a = c.el;
        const form = a.parentElement!;
        const go: Driver = {
          id: 'typing', lib: 'native', kinds: ['text'], match: () => true,
          fill: async (control) => {
            (control.el as HTMLInputElement).value = 'Zhiyuan';
            if (control.el === a) {
              a.remove();
              const late = document.createElement('input');
              late.type = 'text';
              form.append(late);
              return { ok: false, observed: null };
            }
            return { ok: true, observed: 'Zhiyuan' };
          },
          read: (control) => (control.el as HTMLInputElement).value,
        };
        await executeStep(text, c, document, { resolveDriver: () => go });
        expect((document.querySelector('#b') as HTMLInputElement).value).toBe('me@example.com');
      });

      it('does not follow to an input that turned up somewhere else', async () => {
        const c = firstControl('<div id="row"><input type="tel"></div><div id="far"></div>');
        c.el.addEventListener('blur', () => {
          const row = c.el.parentElement!;
          row.remove();
          const next = document.createElement('input');
          next.type = 'tel';
          next.value = 'Zhiyuan';
          document.querySelector('#far')!.append(next);
        });
        const r = await executeStep(text, c, document);
        expect(r.outcome).toBe('action_failed');
      });

      it('does not follow to a box that says it is something else', async () => {
        const c = firstControl('<div><label for="c">City</label><input id="c" name="city" type="text"></div><div><input type="text" name="other"></div>');
        const box = c.el.parentElement!;
        const go: Driver = {
          id: 'typing', lib: 'native', kinds: ['text'], match: () => true,
          fill: async (control) => {
            const el = control.el as HTMLInputElement;
            el.value = 'Brisbane';
            if (el.name !== 'city') return { ok: true, observed: 'Brisbane' };
            box.innerHTML = '<label for="r">Referral code</label><input id="r" name="referral_code" type="text">';
            return { ok: false, observed: null };
          },
          read: (control) => (control.el as HTMLInputElement).value,
        };
        const r = await executeStep(text, c, document, { resolveDriver: () => go });
        expect((document.querySelector('#r') as HTMLInputElement).value).toBe('');
        expect(r.outcome).not.toBe('filled');
      });

      it('follows a box whose generated name changes and whose label stays', async () => {
        const c = firstControl('<div><label for="c">City</label><input id="c" name="rnAbnpJH60" type="text"></div><div><input type="text"></div>');
        c.el.addEventListener('blur', () => {
          c.el.parentElement!.innerHTML = '<label for="d">City</label><input id="d" name="xQ7hTz2Lm1" type="text" value="Zhiyuan">';
        });
        const r = await executeStep(text, c, document);
        expect(r).toMatchObject({ outcome: 'filled', observed: 'Zhiyuan' });
      });

      it('does not follow a rebuilt checkbox, whose answer is read from the old one', async () => {
        const c = firstControl('<div><input id="t" type="checkbox"><label for="t">Keep me posted</label></div><div><input type="checkbox"></div>');
        const old = c.el as HTMLInputElement;
        const go: Driver = {
          id: 'ticking', lib: 'native', kinds: ['checkbox'], match: () => true,
          fill: async () => {
            old.checked = true;
            const next = document.createElement('input');
            next.type = 'checkbox';
            old.replaceWith(next);
            return { ok: true, observed: 'true' };
          },
          read: () => (old.checked ? 'true' : null),
        };
        const r = await executeStep(step({ intent: { kind: 'check', checked: true } }), { ...c, kind: 'checkbox' }, document, { resolveDriver: () => go });
        expect(r.outcome).toBe('action_failed');
      });

      it('a file box replaced after taking its file is still filled', async () => {
        const c = firstControl('<div><input id="f" type="file"></div><div><input type="file"></div>');
        const old = c.el as HTMLInputElement;
        const go: Driver = {
          id: 'upload', lib: 'native', kinds: ['file'], match: () => true,
          fill: async () => {
            const next = document.createElement('input');
            next.type = 'file';
            old.replaceWith(next);
            return { ok: true, observed: 'cv.pdf' };
          },
          read: (control) => (control.el === old ? 'cv.pdf' : null),
        };
        const file = { name: 'cv.pdf', mime: 'application/pdf', dataUrl: 'data:application/pdf;base64,AA==' };
        const r = await executeStep(step({ intent: { kind: 'file', file } as never }), { ...c, kind: 'file' }, document, { resolveDriver: () => go });
        expect(r.outcome).toBe('filled');
      });

      it('a select that came back empty is not filled', async () => {
        const c = firstControl('<div><select><option value="">Choose</option><option>Australia</option></select></div><div><select><option>Other</option></select></div>');
        const old = c.el as HTMLSelectElement;
        old.addEventListener('change', () => {
          const next = document.createElement('select');
          next.innerHTML = '<option value="">Choose</option><option>Australia</option>';
          old.replaceWith(next);
        });
        const fake: Driver = {
          id: 'select', lib: 'native', kinds: ['select'], match: () => true,
          fill: async (control) => {
            const el = control.el as HTMLSelectElement;
            el.value = 'Australia';
            el.dispatchEvent(new Event('change', { bubbles: true }));
            return { ok: true, observed: 'Australia' };
          },
          read: (control) => (control.el as HTMLSelectElement).value || null,
        };
        const r = await executeStep(text, c, document, { resolveDriver: () => fake });
        expect(r.outcome).toBe('action_failed');
      });

      it('does not take a neighbour for it when the number of inputs changed', async () => {
        const c = firstControl('<form><input type="text"><input type="text" value="Zhiyuan"></form>');
        c.el.addEventListener('blur', () => c.el.remove());
        const r = await executeStep(text, c, document);
        expect(r.outcome).toBe('action_failed');
      });
    });

    it('still fails when the field went away with no new element', async () => {
      const c = firstControl('<input id="given" type="text">');
      c.el.addEventListener('blur', () => c.el.remove());
      const r = await executeStep(text, c, document);
      expect(r.outcome).toBe('action_failed');
    });

    it('an element with no id has no provable successor', async () => {
      const c = firstControl('<input type="text">');
      c.el.addEventListener('blur', () => {
        const next = document.createElement('input');
        next.value = (c.el as HTMLInputElement).value;
        c.el.replaceWith(next);
      });
      const r = await executeStep(text, c, document);
      expect(r.outcome).toBe('action_failed');
    });

    it('writes to the new element when the old one went before the turn came', async () => {
      const c = firstControl('<input id="given" type="text">');
      const next = document.createElement('input');
      next.id = 'given';
      next.type = 'text';
      c.el.replaceWith(next);
      const r = await executeStep(text, c, document);
      expect(r.outcome).toBe('filled');
      expect(next.value).toBe('Zhiyuan');
    });
  });

  it('drives the real native driver end to end (default registry)', async () => {
    const c = firstControl('<select><option value="">Select</option><option>Master</option></select>');
    const r = await executeStep(
      step({ fieldKey: 'education.degree', intent: choice('Master'), label: 'Degree' }),
      c,
      document,
    );
    expect(r).toMatchObject({ outcome: 'filled', value: 'Master', observed: 'Master' });
    document.body.innerHTML = '';
    const c2 = firstControl('<select><option value="">Select</option><option>Master</option></select>');
    const miss = await executeStep(step({ intent: choice('PhD') }), c2, document);
    expect(miss.outcome).toBe('no_option');
    expect((c2.el as HTMLSelectElement).selectedIndex).toBe(0);
  });
});
