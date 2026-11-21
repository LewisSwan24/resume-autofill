// Auto-advance in the fill browser, driven through the session with the fake native plugin and a simulated
// four-step form that changes its fields in place when Next is pressed.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { FieldReport } from '../../../../src/engine/types';
import { countOutcomes } from '../../../../src/fill/report';
import { ProfileSchema, ResumeSchema } from '../../../../src/schema';
import { decodeAppCommand, encode, type AppCommand } from '../../../../mobile/bridge/protocol';
import { createFakeFillBrowser } from '../../../../mobile/app/src/browser/native';
import { createBrowserSession } from '../../../../mobile/app/src/browser/model/session';
import { needsConsent, rememberSite, ADVANCE_SITES_MAX } from '../../../../mobile/app/src/browser/model/advance';

const URL_ = 'https://jobs.example.com/apply';
const ORIGIN = 'https://jobs.example.com';
const theme = { bg: 1, surface: 2, text: 3, line: 4, accent: 5, scrim: 6 };
const resume = ResumeSchema.parse({ id: 'r1', title: '我的简历', locale: 'zh-CN', basics: { familyName: '张', givenName: '三' }, contact: { email: 'zhangsan@example.com' } });
const profile = ProfileSchema.parse({ schemaVersion: 1, resumes: [resume], activeResumeId: 'r1' });

const TITLES = ['基本信息', '教育经历', '实习经历', '其他信息'];
const row = (id: string, outcome: FieldReport['outcome']): FieldReport => ({ fieldId: id, label: id, fieldKey: null, section: null, outcome, confidence: 1 });

interface FormOpts {
  /** Step (0-based) whose page says a required field is empty. */
  blockAt?: number;
  /** Step (0-based) on which a press does nothing. */
  stuckAt?: number;
}

async function rig(opts: FormOpts = {}) {
  const native = createFakeFillBrowser();
  const commands: AppCommand[] = [];
  const form = { step: 0, block: opts.blockAt };
  let ids = 0;
  const reply = (data: object) =>
    native.emit('message', { frame: 0, generation: session.getState().generation, origin: ORIGIN, main: true, data: JSON.stringify(data) });
  native.deliver = (o) => {
    const cmd = decodeAppCommand(o.data);
    if (!cmd || o.frame !== 0) return true;
    commands.push(cmd);
    let answer: object | null = null;
    const last = form.step === TITLES.length - 1;
    if (cmd.kind === 'needs') answer = { v: 1, kind: 'needs', reqId: cmd.reqId, needs: { fieldKeys: ['contact.email'], repeatSections: [], attachmentKeys: [] } };
    if (cmd.kind === 'fill') {
      const fields = [row(`s${form.step}a`, 'filled'), row(`s${form.step}b`, form.step === 1 ? 'needs_review' : 'filled'), row(`s${form.step}c`, 'no_data')];
      answer = { v: 1, kind: 'report', reqId: cmd.reqId, runId: cmd.runId, report: { url: URL_, startedAt: 1, finishedAt: 2, fields, counts: countOutcomes(fields) } };
    }
    if (cmd.kind === 'step') {
      answer = {
        v: 1,
        kind: 'step',
        reqId: cmd.reqId,
        state: { url: URL_, fingerprint: `f${form.step}`, action: last ? 'final' : 'next', blocker: form.block === form.step ? 'needs_you' : null, userInputAt: 0, title: TITLES[form.step] },
      };
    }
    if (cmd.kind === 'press') {
      if (last) answer = { v: 1, kind: 'pressed', reqId: cmd.reqId, pressed: false, reason: 'final_step' };
      else {
        answer = { v: 1, kind: 'pressed', reqId: cmd.reqId, pressed: true };
        if (opts.stuckAt !== form.step) setTimeout(() => form.step++, 100);
      }
    }
    if (answer) void Promise.resolve().then(() => reply(answer!));
    return true;
  };
  const session = createBrowserSession({
    target: { url: URL_, demo: false },
    native,
    getFillContext: () => ({ profile, fillLanguage: 'active' }),
    readFile: async () => null,
    onTitle: () => undefined,
    newId: () => `id${++ids}`,
  });
  await session.start({ top: 56, bottom: 56 }, theme);
  native.emit('navigation', { phase: 'started', url: URL_, generation: 1, canGoBack: false, canGoForward: false });
  native.emit('navigation', { phase: 'finished', url: URL_, generation: 1, canGoBack: false, canGoForward: false });
  native.emit('message', { frame: 0, generation: 1, origin: ORIGIN, main: true, data: encode({ v: 1, kind: 'hello', iframes: 0 }) });
  native.emit('message', { frame: 0, generation: 1, origin: ORIGIN, main: true, data: encode({ v: 1, kind: 'scan', count: 3, iframes: 0 }) });
  const kinds = (k: AppCommand['kind']) => commands.filter((c) => c.kind === k).length;
  return { native, session, form, commands, kinds };
}

const wait = (ms = 0) => vi.advanceTimersByTimeAsync(ms);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('offer', () => {
  it('after a fill, a page with a Next button is offered auto-advance, as step 1 with its title', async () => {
    const r = await rig();
    await r.session.fill();
    await wait(100);
    const s = r.session.getState();
    expect(s.stepOffer).toEqual({ step: 1, title: '基本信息' });
    expect(s.wizard?.steps).toEqual([{ fingerprint: 'f0', title: '基本信息', filled: 2, attention: 0, skipped: 1 }]);
    expect(r.kinds('press')).toBe(0);
  });

  it('the last page is not offered: only a send button is left', async () => {
    const r = await rig();
    r.form.step = 3;
    await r.session.fill();
    await wait(100);
    expect(r.session.getState().stepOffer).toBeNull();
  });
});

describe('advance', () => {
  it('presses Next, fills every step, and stops at the last page without pressing its send button', async () => {
    const r = await rig();
    await r.session.fill();
    await wait(100);
    r.session.startAdvance();
    await wait(1);
    expect(r.session.getState().advance).toMatchObject({ running: true });
    await wait(20_000);
    const s = r.session.getState();
    expect(s.advance).toEqual({ running: false, steps: 3, stopReason: 'final_step' });
    expect(r.form.step).toBe(3);
    expect(r.kinds('press')).toBe(3);
    expect(r.kinds('fill')).toBe(4);
    expect(s.wizard?.steps.map((x) => [x.title, x.filled, x.attention, x.skipped])).toEqual([
      ['基本信息', 2, 0, 1],
      ['教育经历', 1, 1, 1],
      ['实习经历', 2, 0, 1],
      ['其他信息', 2, 0, 1],
    ]);
    expect(s.stepOffer).toBeNull();
  });

  it('stops where the page needs the person, and continuing goes on counting from there', async () => {
    const r = await rig({ blockAt: 1 });
    await r.session.fill();
    await wait(100);
    r.session.startAdvance();
    await wait(20_000);
    expect(r.session.getState().advance).toEqual({ running: false, steps: 1, stopReason: 'needs_you' });
    expect(r.form.step).toBe(1);

    r.form.block = undefined; // the person filled it in
    r.session.startAdvance();
    await wait(20_000);
    expect(r.session.getState().advance).toEqual({ running: false, steps: 3, stopReason: 'final_step' });
  });

  it('a Next that changes nothing stops with not_advanced after 10 s', async () => {
    const r = await rig({ stuckAt: 0 });
    await r.session.fill();
    await wait(100);
    r.session.startAdvance();
    await wait(20_000);
    expect(r.session.getState().advance).toEqual({ running: false, steps: 0, stopReason: 'not_advanced' });
  });

  it('stopAdvance stops before the next step', async () => {
    const r = await rig();
    await r.session.fill();
    await wait(100);
    r.session.startAdvance();
    await wait(1);
    r.session.stopAdvance();
    await wait(20_000);
    expect(r.session.getState().advance?.stopReason).toBe('stopped');
    expect(r.form.step).toBeLessThanOrEqual(1);
  });

  it('a page of another site ends the run: resume data never follows it there', async () => {
    const r = await rig();
    await r.session.fill();
    await wait(100);
    r.session.startAdvance();
    await wait(1);
    r.native.emit('navigation', { phase: 'started', url: 'https://other.example.net/x', generation: 2, canGoBack: true, canGoForward: false });
    await wait(20_000);
    expect(r.session.getState().advance?.stopReason).toBe('left_site');
    expect(r.kinds('fill')).toBe(1);
  });

  it("while it runs, a tap on fill answers busy", async () => {
    const r = await rig();
    await r.session.fill();
    await wait(100);
    r.session.startAdvance();
    await wait(1);
    expect(await r.session.fill()).toBe('busy');
    r.session.stopAdvance();
    await wait(20_000);
  });
});

describe('consent per site', () => {
  it('asks on a site never confirmed, not on one confirmed before', () => {
    expect(needsConsent([], ORIGIN)).toBe(true);
    const sites = rememberSite([], ORIGIN);
    expect(needsConsent(sites, ORIGIN)).toBe(false);
    expect(needsConsent(sites, 'https://hr.example.org')).toBe(true);
  });

  it('remembers each site once, newest last, and forgets the oldest past the cap', () => {
    let sites: string[] = [];
    for (let i = 0; i < ADVANCE_SITES_MAX + 5; i++) sites = rememberSite(sites, `https://s${i}.example.com`);
    sites = rememberSite(sites, `https://s${ADVANCE_SITES_MAX + 4}.example.com`);
    expect(sites).toHaveLength(ADVANCE_SITES_MAX);
    expect(sites[0]).toBe('https://s5.example.com');
    expect(rememberSite(['https://a.example.com', 'https://b.example.com'], 'https://a.example.com')).toEqual(['https://b.example.com', 'https://a.example.com']);
  });

  it('only http(s) origins count; anything else always asks and is never stored', () => {
    expect(rememberSite([], 'null')).toEqual([]);
    expect(needsConsent(['null'], 'null')).toBe(true);
  });
});

describe('after a stop', () => {
  it('a fill by hand clears the last stop: its notice belongs to the run that ended', async () => {
    const r = await rig();
    await r.session.fill();
    await wait(100);
    r.session.startAdvance();
    await wait(20_000);
    expect(r.session.getState().advance?.stopReason).toBe('final_step');
    r.form.step = 1; // the person went back a page
    await r.session.fill();
    await wait(100);
    expect(r.session.getState().advance).toBeNull();
    expect(r.session.getState().stepOffer).toEqual({ step: 2, title: '教育经历' });
    expect(r.session.getState().wizard?.steps).toHaveLength(4);
  });
});

describe('reload', () => {
  it('reloading the page starts the form over: its steps, the offer and the last stop are gone', async () => {
    const r = await rig();
    await r.session.fill();
    await wait(100);
    r.session.startAdvance();
    await wait(20_000);
    expect(r.session.getState().wizard?.steps).toHaveLength(4);
    r.session.reloadOrStop();
    expect(r.session.getState()).toMatchObject({ wizard: null, advance: null, stepOffer: null });
  });
});
