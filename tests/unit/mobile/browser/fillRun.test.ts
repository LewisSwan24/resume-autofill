// The run machine, driven through the session with the fake native plugin and a simulated page.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildResumeSubset } from '../../../../src/background/subset';
import type { FrameNeeds } from '../../../../src/engine/fieldDeps';
import type { FieldReport } from '../../../../src/engine/types';
import { countOutcomes } from '../../../../src/fill/report';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../../src/schema';
import { decodeAppCommand, encode, type AppCommand } from '../../../../mobile/bridge/protocol';
import { createFakeFillBrowser, type FakeFillBrowser } from '../../../../mobile/app/src/browser/native';
import { createBrowserSession, type BrowserSession } from '../../../../mobile/app/src/browser/model/session';

const URL_ = 'https://jobs.example.com/apply';
const ORIGIN = 'https://jobs.example.com';
const theme = { bg: 1, surface: 2, text: 3, line: 4, accent: 5, scrim: 6 };

const resume = ResumeSchema.parse({
  id: 'r1',
  title: '我的简历',
  locale: 'zh-CN',
  basics: { familyName: '张', givenName: '三', idNumber: '110101200001010000' },
  contact: { email: 'zhangsan@example.com', phone: '13800000000' },
  attachments: { resumeFileId: 'f-cv' },
});
const profileWith = (): Profile => ProfileSchema.parse({ schemaVersion: 1, resumes: [resume], activeResumeId: 'r1' });

type Page = (cmd: AppCommand) => object | null | 'silent';
const needs = (over: Partial<FrameNeeds> = {}): FrameNeeds => ({ fieldKeys: [], repeatSections: [], attachmentKeys: [], ...over });
const filledRow = (id: string): FieldReport => ({ fieldId: id, label: id, fieldKey: null, section: null, outcome: 'filled', confidence: 1, value: 'x' });

/** A frame that answers needs with `n` and fill with a report of one filled row per field id. */
function page(n: FrameNeeds, rows: string[] = ['c1']): Page {
  return (cmd) => {
    if (cmd.kind === 'needs') return { v: 1, kind: 'needs', reqId: cmd.reqId, needs: n };
    if (cmd.kind === 'fill') {
      const fields = rows.map(filledRow);
      return { v: 1, kind: 'report', reqId: cmd.reqId, runId: cmd.runId, report: { url: URL_, startedAt: 1, finishedAt: 2, fields, counts: countOutcomes(fields) } };
    }
    if (cmd.kind === 'undo') return { v: 1, kind: 'undone', reqId: cmd.reqId, runId: cmd.runId, restored: rows, manual: [], addedCards: 0 };
    if (cmd.kind === 'focus') return { v: 1, kind: 'focused', reqId: cmd.reqId, ok: true };
    return null;
  };
}

interface Rig {
  native: FakeFillBrowser;
  session: BrowserSession;
  pages: Map<number, Page>;
  commands: { frame: number; cmd: AppCommand }[];
  profile: { current: Profile | null };
  checkIn(frame: number, opts?: { main?: boolean; count?: number; origin?: string }): void;
  emitReply(frame: number, data: object): void;
}

async function rig(): Promise<Rig> {
  const native = createFakeFillBrowser();
  const pages = new Map<number, Page>();
  const commands: Rig['commands'] = [];
  const profile = { current: profileWith() as Profile | null };
  const mains = new Map<number, boolean>();
  const origins = new Map<number, string>();
  let ids = 0;
  const emitReply = (frame: number, data: object) =>
    native.emit('message', { frame, generation: session.getState().generation, origin: origins.get(frame) ?? ORIGIN, main: mains.get(frame) ?? false, data: JSON.stringify(data) });
  native.deliver = (o) => {
    const cmd = decodeAppCommand(o.data);
    if (!cmd) return true;
    commands.push({ frame: o.frame, cmd });
    const handler = pages.get(o.frame);
    const reply = handler?.(cmd);
    if (reply && reply !== 'silent') void Promise.resolve().then(() => emitReply(o.frame, reply));
    return true;
  };
  const session = createBrowserSession({
    target: { url: URL_, demo: false },
    native,
    getFillContext: () => ({ profile: profile.current, fillLanguage: 'active' }),
    readFile: async (id) => (id === 'f-cv' ? { info: { id, name: 'cv.pdf', type: 'application/pdf', size: 3, createdAt: 0 }, bytes: new Uint8Array([1, 2, 3]) } : null),
    onTitle: () => undefined,
    newId: () => `id${++ids}`,
  });
  await session.start({ top: 56, bottom: 56 }, theme);
  native.emit('navigation', { phase: 'started', url: URL_, generation: 1, canGoBack: false, canGoForward: false });
  native.emit('navigation', { phase: 'finished', url: URL_, generation: 1, canGoBack: false, canGoForward: false });
  return {
    native,
    session,
    pages,
    commands,
    profile,
    emitReply,
    checkIn(frame, opts = {}) {
      const main = opts.main ?? frame === 0;
      mains.set(frame, main);
      origins.set(frame, opts.origin ?? ORIGIN);
      const gen = session.getState().generation;
      native.emit('message', { frame, generation: gen, origin: opts.origin ?? ORIGIN, main, data: encode({ v: 1, kind: 'hello', iframes: 0 }) });
      native.emit('message', { frame, generation: gen, origin: opts.origin ?? ORIGIN, main, data: encode({ v: 1, kind: 'scan', count: opts.count ?? 3, iframes: 0 }) });
    },
  };
}

const flush = () => vi.advanceTimersByTimeAsync(0);
const kinds = (r: Rig, kind: AppCommand['kind']) => r.commands.filter((c) => c.cmd.kind === kind);

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('fill run', () => {
  it('posts needs to every registered frame, then fill only to frames with needs, main frame first', async () => {
    const r = await rig();
    r.checkIn(5, { main: false });
    r.checkIn(0);
    r.checkIn(2, { main: false });
    r.pages.set(0, page(needs({ fieldKeys: ['contact.email'] })));
    r.pages.set(2, page(needs()));
    r.pages.set(5, page(needs({ fieldKeys: ['contact.phone'] })));
    expect(await r.session.fill()).toBe('started');
    await flush();
    expect(kinds(r, 'needs').map((c) => c.frame).sort()).toEqual([0, 2, 5]);
    expect(kinds(r, 'fill').map((c) => c.frame)).toEqual([0, 5]);
    const run = r.session.getState().run;
    expect(run.phase).toBe('done');
    if (run.phase === 'done') {
      expect(run.frames).toEqual([0, 5]);
      expect(run.report.fields.map((f) => f.frameId)).toEqual([0, 5]);
    }
  });

  it('each frame receives exactly buildResumeSubset(resume, its needs)', async () => {
    const r = await rig();
    r.checkIn(0);
    r.checkIn(1, { main: false });
    const n0 = needs({ fieldKeys: ['basics.familyName', 'basics.idNumber'] });
    const n1 = needs({ fieldKeys: ['contact.email'], attachmentKeys: ['attachments.resume'] });
    r.pages.set(0, page(n0));
    r.pages.set(1, page(n1));
    await r.session.fill();
    await flush();
    const fills = kinds(r, 'fill').map((c) => c.cmd as Extract<AppCommand, { kind: 'fill' }>);
    expect(fills[0]!.resume).toEqual(buildResumeSubset(resume, n0));
    expect(fills[0]!.resume.basics.idNumber).toBe('');
    expect(fills[0]!.files).toEqual({});
    expect(fills[1]!.resume).toEqual(buildResumeSubset(resume, n1));
    expect(Object.keys(fills[1]!.files)).toEqual(['f-cv']);
    expect(fills[1]!.files['f-cv']!.dataUrl).toBe('data:application/pdf;base64,AQID');
  });

  it('nothing is posted with resume data before the tap', async () => {
    const r = await rig();
    r.checkIn(0);
    r.pages.set(0, page(needs({ fieldKeys: ['contact.email'] })));
    await flush();
    await vi.advanceTimersByTimeAsync(20_000);
    expect(r.commands).toEqual([]);
  });

  it('a frame that does not answer needs within 5 s gets no fill; the run still completes', async () => {
    const r = await rig();
    r.checkIn(0);
    r.checkIn(1, { main: false });
    r.pages.set(0, page(needs({ fieldKeys: ['contact.email'] })));
    r.pages.set(1, () => 'silent');
    await r.session.fill();
    await vi.advanceTimersByTimeAsync(5_001);
    expect(kinds(r, 'fill').map((c) => c.frame)).toEqual([0]);
    expect(r.session.getState().run.phase).toBe('done');
  });

  it('a frame that does not answer fill within 30 s is left out of the merged report', async () => {
    const r = await rig();
    r.checkIn(0);
    r.checkIn(1, { main: false });
    r.pages.set(0, page(needs({ fieldKeys: ['contact.email'] })));
    const answersNeedsOnly = page(needs({ fieldKeys: ['contact.phone'] }));
    r.pages.set(1, (cmd) => (cmd.kind === 'fill' ? 'silent' : answersNeedsOnly(cmd)));
    await r.session.fill();
    await flush();
    expect(r.session.getState().run.phase).toBe('filling');
    await vi.advanceTimersByTimeAsync(30_001);
    const run = r.session.getState().run;
    expect(run.phase).toBe('done');
    if (run.phase === 'done') expect(run.report.fields.map((f) => f.frameId)).toEqual([0]);
  });

  it('drops a reply with an unknown reqId or from another frame', async () => {
    const r = await rig();
    r.checkIn(0);
    r.checkIn(1, { main: false });
    r.pages.set(0, () => 'silent');
    r.pages.set(1, () => 'silent');
    await r.session.fill();
    await flush();
    const [toMain] = kinds(r, 'needs').filter((c) => c.frame === 0);
    const reqId = (toMain!.cmd as { reqId: string }).reqId;
    const body = { v: 1, kind: 'needs', needs: needs({ fieldKeys: ['contact.email'] }) };
    r.emitReply(0, { ...body, reqId: 'not-asked' });
    r.emitReply(1, { ...body, reqId });
    await vi.advanceTimersByTimeAsync(5_001);
    expect(kinds(r, 'fill')).toEqual([]);
    expect(r.session.getState().run).toEqual({ phase: 'failed', code: 'no_frames' });
  });

  it('a second fill() during a run returns busy and posts nothing', async () => {
    const r = await rig();
    r.checkIn(0);
    r.pages.set(0, () => 'silent');
    await r.session.fill();
    const before = r.native.posts.length;
    expect(await r.session.fill()).toBe('busy');
    expect(r.native.posts.length).toBe(before);
  });

  /** 12 education entries × every education leaf is well above LARGE_NEEDS. */
  const bigProfile = (): Profile =>
    ProfileSchema.parse({
      schemaVersion: 1,
      resumes: [{ ...resume, education: Array.from({ length: 12 }, (_, i) => ({ school: `示例大学 ${i}` })) }],
      activeResumeId: 'r1',
    });
  const bigNeeds = needs({ fieldKeys: ['contact.email'], repeatSections: ['education'] });

  it('large needs pause in confirmLarge; confirmLarge(false) ends with no fill posted', async () => {
    const r = await rig();
    r.profile.current = bigProfile();
    r.checkIn(0);
    r.pages.set(0, page(bigNeeds));
    await r.session.fill();
    await flush();
    const run = r.session.getState().run;
    expect(run.phase).toBe('confirmLarge');
    if (run.phase === 'confirmLarge') expect(run.leaves).toBeGreaterThan(200);
    r.session.confirmLarge(false);
    await flush();
    expect(kinds(r, 'fill')).toEqual([]);
    expect(r.session.getState().run.phase).toBe('idle');
  });

  it('confirmLarge(true) goes on and fills', async () => {
    const r = await rig();
    r.profile.current = bigProfile();
    r.checkIn(0);
    r.pages.set(0, page(bigNeeds));
    await r.session.fill();
    await flush();
    r.session.confirmLarge(true);
    await flush();
    expect(kinds(r, 'fill').map((c) => c.frame)).toEqual([0]);
    expect(r.session.getState().run.phase).toBe('done');
  });

  it('no resume → no_resume and nothing posted; no frame with needs → failed no_frames', async () => {
    const r = await rig();
    r.checkIn(0);
    r.pages.set(0, page(needs()));
    r.profile.current = null;
    expect(await r.session.fill()).toBe('no_resume');
    expect(r.native.posts).toEqual([]);
    r.profile.current = profileWith();
    expect(await r.session.fill()).toBe('started');
    await flush();
    expect(r.session.getState().run).toEqual({ phase: 'failed', code: 'no_frames' });
  });

  it('a main-frame navigation during the run ends it; late replies change nothing', async () => {
    const r = await rig();
    r.checkIn(0);
    r.pages.set(0, () => 'silent');
    await r.session.fill();
    await flush();
    const reqId = (kinds(r, 'needs')[0]!.cmd as { reqId: string }).reqId;
    r.native.emit('navigation', { phase: 'started', url: 'https://jobs.example.com/next', generation: 2, canGoBack: true, canGoForward: false });
    expect(r.session.getState().run).toEqual({ phase: 'failed', code: 'failed' });
    r.native.emit('message', { frame: 0, generation: 1, origin: ORIGIN, main: true, data: encode({ v: 1, kind: 'needs', reqId, needs: needs({ fieldKeys: ['contact.email'] }) }) });
    await vi.advanceTimersByTimeAsync(40_000);
    expect(kinds(r, 'fill')).toEqual([]);
    expect(r.session.getState().run).toEqual({ phase: 'failed', code: 'failed' });
  });

  it('after done, a late report does not change the report', async () => {
    const r = await rig();
    r.checkIn(0);
    r.pages.set(0, page(needs({ fieldKeys: ['contact.email'] })));
    await r.session.fill();
    await flush();
    const before = r.session.getState().run;
    const fill = kinds(r, 'fill')[0]!.cmd as { reqId: string; runId: string };
    const fields = [filledRow('c99')];
    r.emitReply(0, { v: 1, kind: 'report', reqId: fill.reqId, runId: fill.runId, report: { url: URL_, startedAt: 1, finishedAt: 2, fields, counts: countOutcomes(fields) } });
    await flush();
    expect(r.session.getState().run).toBe(before);
  });

  it('undo() posts undo with the run id to exactly the frames that were filled and marks rows', async () => {
    const r = await rig();
    r.checkIn(0);
    r.checkIn(1, { main: false });
    r.checkIn(2, { main: false });
    r.pages.set(0, page(needs({ fieldKeys: ['contact.email'] }), ['c1', 'c2']));
    r.pages.set(1, page(needs()));
    const p2 = page(needs({ fieldKeys: ['contact.phone'] }), ['c7']);
    r.pages.set(2, (cmd) => (cmd.kind === 'undo' ? { v: 1, kind: 'undone', reqId: cmd.reqId, runId: cmd.runId, restored: [], manual: ['c7'], addedCards: 1 } : p2(cmd)));
    await r.session.fill();
    await flush();
    const run = r.session.getState().run;
    await r.session.undo();
    await flush();
    const undos = kinds(r, 'undo');
    expect(undos.map((c) => c.frame).sort()).toEqual([0, 2]);
    expect(undos.every((c) => (c.cmd as { runId: string }).runId === (run as { runId: string }).runId)).toBe(true);
    const after = r.session.getState().run;
    expect(after.phase === 'done' && after.undo).toEqual({ restored: ['0:c1', '0:c2'], manual: ['2:c7'], addedCards: 1 });
    expect(kinds(r, 'clear').map((c) => c.frame)).toEqual([1]);
  });

  it('the blocker covers the page while a run is active and is removed afterwards', async () => {
    const r = await rig();
    r.checkIn(0);
    r.pages.set(0, page(needs({ fieldKeys: ['contact.email'] })));
    await r.session.fill();
    expect(r.native.callsOf('setPageCover').at(-1)).toEqual({ block: true, scrim: false });
    await flush();
    expect(r.native.callsOf('setPageCover').at(-1)).toEqual({ block: false, scrim: false });
  });
});

describe('fill run – edge cases', () => {
  it('a filled frame that never reports ends done with no rows, not failed: the page may have changed, so undo stays', async () => {
    const r = await rig();
    r.checkIn(0);
    const answersNeedsOnly = page(needs({ fieldKeys: ['contact.email'] }));
    r.pages.set(0, (cmd) => (cmd.kind === 'fill' ? 'silent' : answersNeedsOnly(cmd)));
    await r.session.fill();
    await flush();
    await vi.advanceTimersByTimeAsync(30_001);
    const run = r.session.getState().run;
    expect(run.phase).toBe('done');
    if (run.phase !== 'done') return;
    expect(run.frames).toEqual([0]);
    expect(run.unanswered).toBe(1);
    expect(run.report.fields).toEqual([]);
    // Undo still reaches the frame, and what it restored is listed.
    r.pages.set(0, (cmd) => (cmd.kind === 'undo' ? { v: 1, kind: 'undone', reqId: cmd.reqId, runId: cmd.runId, restored: ['c1'], manual: [], addedCards: 0 } : null));
    await r.session.undo();
    await flush();
    const after = r.session.getState().run;
    expect(after.phase === 'done' && after.undo).toEqual({ restored: ['0:c1'], manual: [], addedCards: 0 });
  });

  it('a report from every frame leaves unanswered at 0', async () => {
    const r = await rig();
    r.checkIn(0);
    r.pages.set(0, page(needs({ fieldKeys: ['contact.email'] })));
    await r.session.fill();
    await flush();
    const run = r.session.getState().run;
    expect(run.phase === 'done' && run.unanswered).toBe(0);
  });

  it('undo twice in a row sends one undo, and the real result stays', async () => {
    const r = await rig();
    r.checkIn(0);
    r.pages.set(0, page(needs({ fieldKeys: ['contact.email'] }), ['c1', 'c2']));
    await r.session.fill();
    await flush();
    let undos = 0;
    const answer = page(needs(), ['c1', 'c2']);
    r.pages.set(0, (cmd) => {
      if (cmd.kind !== 'undo') return answer(cmd);
      undos += 1;
      // The page's journal is used up by the first undo.
      return undos === 1 ? answer(cmd) : { v: 1, kind: 'error', reqId: cmd.reqId, code: 'undo_failed' };
    });
    const first = r.session.undo();
    const second = r.session.undo();
    await Promise.all([first, second]);
    await flush();
    expect(kinds(r, 'undo')).toHaveLength(1);
    const after = r.session.getState().run;
    expect(after.phase === 'done' && after.undo).toEqual({ restored: ['0:c1', '0:c2'], manual: [], addedCards: 0 });
  });

  it('a late second undo answer never overwrites an undo that already landed', async () => {
    const r = await rig();
    r.checkIn(0);
    r.pages.set(0, page(needs({ fieldKeys: ['contact.email'] }), ['c1']));
    await r.session.fill();
    await flush();
    await r.session.undo();
    await flush();
    const landed = r.session.getState().run;
    await r.session.undo();
    await flush();
    expect(r.session.getState().run).toBe(landed);
    expect(kinds(r, 'undo')).toHaveLength(1);
  });
});

describe('frames of other sites', () => {
  const VENDOR = 'https://forms.vendor-example.net';
  const email = needs({ fieldKeys: ['contact.email'] });
  const phone = needs({ fieldKeys: ['contact.phone'] });

  it('fills a frame of the page own host or a subdomain of it without asking, and tells each fill its origin', async () => {
    const r = await rig();
    r.checkIn(0);
    r.checkIn(1, { main: false, origin: 'https://forms.jobs.example.com' });
    r.pages.set(0, page(email));
    r.pages.set(1, page(phone));
    await r.session.fill();
    await flush();
    expect(kinds(r, 'fill').map((c) => c.frame)).toEqual([0, 1]);
    const run = r.session.getState().run;
    expect(run.phase).toBe('done');
    if (run.phase === 'done') expect(run.handedOver.otherSites).toEqual([]);
    const origins = kinds(r, 'fill').map((c) => (c.cmd as Extract<AppCommand, { kind: 'fill' }>).origin);
    expect(origins).toEqual([ORIGIN, 'https://forms.jobs.example.com']);
  });

  it('asks about a sibling subdomain: the shared parent may be a public suffix this app does not know', async () => {
    const r = await rig();
    r.checkIn(0);
    r.checkIn(1, { main: false, origin: 'https://apply.example.com' });
    r.pages.set(0, page(email));
    r.pages.set(1, page(phone));
    await r.session.fill();
    await flush();
    const run = r.session.getState().run;
    if (run.phase !== 'confirmSites') throw new Error(run.phase);
    expect(run.hosts).toEqual(['apply.example.com']);
  });

  it('a frame that changed origin after the question gets nothing, even after yes', async () => {
    const r = await rig();
    r.checkIn(0);
    r.checkIn(1, { main: false, origin: 'https://forms.jobs.example.com' });
    r.checkIn(2, { main: false, origin: VENDOR });
    r.pages.set(0, page(email));
    r.pages.set(1, page(phone));
    r.pages.set(2, page(phone));
    await r.session.fill();
    await flush();
    expect(r.session.getState().run.phase).toBe('confirmSites');
    // frame 1 navigates elsewhere while the question is open: bye, then hello from its new document
    r.emitReply(1, { v: 1, kind: 'bye' });
    r.checkIn(1, { main: false, origin: 'https://evil.example.net' });
    r.session.confirmSites(true);
    await flush();
    expect(kinds(r, 'fill').map((c) => c.frame)).toEqual([0, 2]);
  });

  it('asks, naming the host, before any fill when another site has fields; no keeps the data on this site', async () => {
    const r = await rig();
    r.checkIn(0);
    r.checkIn(1, { main: false, origin: VENDOR });
    r.pages.set(0, page(email));
    r.pages.set(1, page(phone));
    await r.session.fill();
    await flush();
    const run = r.session.getState().run;
    expect(run.phase).toBe('confirmSites');
    if (run.phase === 'confirmSites') expect(run.hosts).toEqual(['forms.vendor-example.net']);
    expect(kinds(r, 'fill')).toEqual([]);
    r.session.confirmSites(false);
    await flush();
    expect(kinds(r, 'fill').map((c) => c.frame)).toEqual([0]);
    const done = r.session.getState().run;
    expect(done.phase).toBe('done');
    if (done.phase === 'done') expect(done.handedOver.otherSites).toEqual([]);
  });

  it('yes fills the other site too and the report names it', async () => {
    const r = await rig();
    r.checkIn(0);
    r.checkIn(1, { main: false, origin: VENDOR });
    r.pages.set(0, page(email));
    r.pages.set(1, page(phone));
    await r.session.fill();
    await flush();
    r.session.confirmSites(true);
    await flush();
    expect(kinds(r, 'fill').map((c) => c.frame)).toEqual([0, 1]);
    const run = r.session.getState().run;
    if (run.phase !== 'done') throw new Error(run.phase);
    expect(run.handedOver.otherSites).toEqual(['forms.vendor-example.net']);
  });

  it('does not ask about another site that asked for nothing', async () => {
    const r = await rig();
    r.checkIn(0);
    r.checkIn(1, { main: false, origin: VENDOR });
    r.pages.set(0, page(email));
    r.pages.set(1, page(needs()));
    await r.session.fill();
    await flush();
    expect(r.session.getState().run.phase).toBe('done');
    expect(kinds(r, 'fill').map((c) => c.frame)).toEqual([0]);
  });

  it('only other sites with fields, and no: nothing is posted and the run ends idle', async () => {
    const r = await rig();
    r.checkIn(0);
    r.checkIn(1, { main: false, origin: VENDOR });
    r.checkIn(2, { main: false, origin: 'https://www.vendor-example.net' });
    r.pages.set(0, page(needs()));
    r.pages.set(1, page(phone));
    r.pages.set(2, page(email));
    await r.session.fill();
    await flush();
    const run = r.session.getState().run;
    if (run.phase !== 'confirmSites') throw new Error(run.phase);
    expect(run.hosts).toEqual(['forms.vendor-example.net', 'vendor-example.net']);
    r.session.confirmSites(false);
    await flush();
    expect(kinds(r, 'fill')).toEqual([]);
    expect(r.session.getState().run.phase).toBe('idle');
  });
});

describe('sensitive fields', () => {
  const withMode = (mode: 'fill' | 'remind'): Profile =>
    ProfileSchema.parse({ schemaVersion: 1, resumes: [resume], activeResumeId: 'r1', settings: { sensitiveFields: mode } });
  const heldRow: FieldReport = {
    fieldId: 'id1', label: '证件号码', fieldKey: 'basics.idNumber', section: 'basics', outcome: 'needs_review', confidence: 1, note: 'sensitive_held',
  };

  it('「直接填」 sends the id number and says so to the page; 「只提醒」 sends neither', async () => {
    for (const mode of ['fill', 'remind'] as const) {
      const r = await rig();
      r.profile.current = withMode(mode);
      r.checkIn(0);
      r.pages.set(0, page(needs({ fieldKeys: ['basics.idNumber'] })));
      await r.session.fill();
      await flush();
      const fill = kinds(r, 'fill')[0]!.cmd as Extract<AppCommand, { kind: 'fill' }>;
      expect(fill.resume.basics.idNumber).toBe(mode === 'fill' ? '110101200001010000' : '');
      expect(fill.sensitiveFields).toBe(mode === 'fill' ? 'fill' : undefined);
    }
  });

  it('「这次填上」 fills that one field, sends only the id number, and updates its row in the same report', async () => {
    const r = await rig();
    r.checkIn(0);
    r.pages.set(0, (cmd) => {
      if (cmd.kind === 'needs') return { v: 1, kind: 'needs', reqId: cmd.reqId, needs: needs({ fieldKeys: ['basics.familyName', 'basics.idNumber'] }) };
      if (cmd.kind === 'fill') {
        const fields: FieldReport[] = cmd.only
          ? [{ ...heldRow, outcome: 'filled', note: 'sensitive_filled', value: '110101200001010000' }]
          : [filledRow('c1'), heldRow];
        return { v: 1, kind: 'report', reqId: cmd.reqId, runId: cmd.runId, report: { url: URL_, startedAt: 1, finishedAt: 2, fields, counts: countOutcomes(fields) } };
      }
      return null;
    });
    await r.session.fill();
    await flush();
    const before = r.session.getState().run;
    expect(before.phase === 'done' && before.report.fields[1]!.note).toBe('sensitive_held');

    const result = r.session.fillOne('0:id1');
    await flush();
    expect(await result).toBe('ok');
    const one = kinds(r, 'fill')[1]!.cmd as Extract<AppCommand, { kind: 'fill' }>;
    expect(one.only).toEqual(['id1']);
    expect(one.sensitiveFields).toBe('fill');
    expect(one.resume.basics.idNumber).toBe('110101200001010000');
    expect(one.resume.basics.familyName).toBe('');
    const after = r.session.getState().run;
    expect(after.phase).toBe('done');
    if (after.phase === 'done' && before.phase === 'done') {
      expect(after.runId).toBe(before.runId);
      expect(after.report.fields.map((f) => [f.fieldId, f.outcome, f.note])).toEqual([
        ['c1', 'filled', undefined],
        ['id1', 'filled', 'sensitive_filled'],
      ]);
      expect(after.report.counts.filled).toBe(2);
    }
  });

  it('「这次填上」 on a frame that is gone answers gone and changes nothing', async () => {
    const r = await rig();
    r.checkIn(0);
    r.pages.set(0, page(needs({ fieldKeys: ['basics.idNumber'] })));
    await r.session.fill();
    await flush();
    expect(await r.session.fillOne('7:id1')).toBe('gone');
    expect(kinds(r, 'fill')).toHaveLength(1);
  });
});
