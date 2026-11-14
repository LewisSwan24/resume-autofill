// @vitest-environment-options {"url": "https://jobs.example.com/apply"}
// The page entry of the fill browser (mobile/inject/entry.ts) in jsdom, talking to a fake `rafBridge`.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildResumeSubset } from '../../../../src/background/subset';
import { computeFrameNeeds } from '../../../../src/content/needs';
import { scanDocument } from '../../../../src/engine/scan';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ResumeSchema } from '../../../../src/schema';
import { SAMPLE_RESUME_ZH } from '../../../../mobile/app/src/browser/model/sampleResume';

interface Bridge {
  postMessage(data: string): void;
  onmessage: ((event: { data: unknown }) => void) | null;
}

const FORM = `
  <form>
    <h2>基本信息</h2>
    <div><label for="name">姓名</label><input id="name"><label for="email">电子邮箱</label><input id="email"></div>
    <h2>教育经历</h2>
    <div><label for="school">学校名称</label><input id="school">
      <label for="degree">学历</label>
      <select id="degree"><option value="">请选择</option><option value="本科">本科</option><option value="硕士">硕士</option></select></div>
  </form>
  <iframe id="f1" src="https://a.example.com/x"></iframe>
  <iframe id="f2" src="http://b.example.com/y"></iframe>
  <iframe id="f3" src="about:blank"></iframe>
  <iframe id="f4" src="https://c.example.com/tiny"></iframe>`;

const resume = ResumeSchema.parse({
  id: 'r1',
  title: '',
  locale: 'zh-CN',
  basics: { familyName: '张', givenName: '三' },
  contact: { email: 'zhangsan@example.com', phone: '13800000000' },
  education: [{ school: '示例大学', degree: 'bachelor' }],
});

function setPage(html = FORM) {
  document.body.innerHTML = html;
  const size = (id: string, w: number, h: number) => {
    const el = document.getElementById(id);
    if (el) el.getBoundingClientRect = () => ({ width: w, height: h, top: 0, left: 0, right: w, bottom: h, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
  };
  size('f1', 300, 200);
  size('f2', 300, 200);
  size('f3', 300, 200);
  size('f4', 10, 10);
}

async function boot(withBridge = true) {
  const sent: string[] = [];
  const bridge: Bridge = { postMessage: (d) => sent.push(d), onmessage: null };
  if (withBridge) vi.stubGlobal('rafBridge', bridge);
  vi.resetModules();
  await import('../../../../mobile/inject/entry');
  const msgs = () => sent.map((s) => JSON.parse(s) as Record<string, unknown> & { kind: string });
  const send = (cmd: unknown) => bridge.onmessage?.({ data: typeof cmd === 'string' ? cmd : JSON.stringify(cmd) });
  const reply = (reqId: string) => vi.waitFor(() => {
    const m = msgs().find((x) => x.reqId === reqId);
    if (!m) throw new Error('no reply yet');
    return m;
  }, { timeout: 10_000 });
  return { sent, bridge, msgs, send, reply };
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
});

describe('page entry', () => {
  it('does nothing without rafBridge', async () => {
    setPage();
    const b = await boot(false);
    expect(b.sent).toEqual([]);
    expect((globalThis as { rafBridge?: unknown }).rafBridge).toBeUndefined();
  });

  it('posts nothing on a non-http(s) document', async () => {
    setPage();
    vi.stubGlobal('location', { protocol: 'about:', href: 'about:blank' });
    const b = await boot();
    expect(b.sent).toEqual([]);
    expect(b.bridge.onmessage).toBeNull();
  });

  it('posts hello with the visible http(s) iframe count, then scan with the fillable count', async () => {
    setPage();
    const b = await boot();
    const [hello, scan] = b.msgs();
    expect(hello).toEqual({ v: 1, kind: 'hello', iframes: 2 });
    expect(scan).toEqual({ v: 1, kind: 'scan', count: scanDocument(document).fillableCount, iframes: 2 });
    expect(scan!.count).toBeGreaterThan(0);
  });

  it('answers needs with computeFrameNeeds(document)', async () => {
    setPage();
    const b = await boot();
    b.send({ v: 1, kind: 'needs', reqId: 'n1' });
    const m = await b.reply('n1');
    expect(m).toEqual({ v: 1, kind: 'needs', reqId: 'n1', needs: computeFrameNeeds(document) });
  });

  it('refuses a fill meant for another origin: the frame navigated after the person agreed', async () => {
    setPage();
    const b = await boot();
    const name = document.getElementById('name') as HTMLInputElement;
    const subset = buildResumeSubset(resume, computeFrameNeeds(document));
    b.send({ v: 1, kind: 'fill', reqId: 'w1', runId: 'run1', origin: 'https://forms.vendor-example.net', resume: subset, files: {} });
    expect(await b.reply('w1')).toEqual({ v: 1, kind: 'error', reqId: 'w1', code: 'wrong_origin' });
    expect(name.value).toBe('');
  });

  it('fills a small native form from a subset resume, reports, focuses and undoes', async () => {
    setPage();
    const b = await boot();
    const counts = { name: { input: 0, change: 0 } };
    const name = document.getElementById('name') as HTMLInputElement;
    const email = document.getElementById('email') as HTMLInputElement;
    const degree = document.getElementById('degree') as HTMLSelectElement;

    const subset = buildResumeSubset(resume, computeFrameNeeds(document));
    b.send({ v: 1, kind: 'fill', reqId: 'f1', runId: 'run1', origin: 'https://jobs.example.com', resume: subset, files: {} });
    const report = (await b.reply('f1')) as unknown as { kind: string; runId: string; report: { fields: { fieldId: string; outcome: string }[] } };
    expect(report.kind).toBe('report');
    expect(report.runId).toBe('run1');
    expect(name.value).toBe('张三');
    expect(email.value).toBe('zhangsan@example.com');
    expect(degree.value).toBe('本科');
    const filled = report.report.fields.filter((f) => f.outcome === 'filled');
    expect(filled.length).toBeGreaterThanOrEqual(3);

    const scroll = vi.fn();
    HTMLElement.prototype.scrollIntoView = scroll; // jsdom has no layout
    b.send({ v: 1, kind: 'focus', reqId: 'fo1', fieldId: filled[0]!.fieldId });
    expect(await b.reply('fo1')).toEqual({ v: 1, kind: 'focused', reqId: 'fo1', ok: true });
    expect(scroll).toHaveBeenCalled();
    b.send({ v: 1, kind: 'focus', reqId: 'fo2', fieldId: 'c99999' });
    expect(await b.reply('fo2')).toEqual({ v: 1, kind: 'focused', reqId: 'fo2', ok: false });

    b.send({ v: 1, kind: 'undo', reqId: 'u0', runId: 'other' });
    expect(await b.reply('u0')).toEqual({ v: 1, kind: 'error', reqId: 'u0', code: 'undo_failed' });
    expect(name.value).toBe('张三');

    name.addEventListener('input', () => counts.name.input++);
    name.addEventListener('change', () => counts.name.change++);
    b.send({ v: 1, kind: 'undo', reqId: 'u1', runId: 'run1' });
    const undone = (await b.reply('u1')) as unknown as { kind: string; restored: string[]; manual: string[]; addedCards: number };
    expect(undone.kind).toBe('undone');
    expect(undone.restored.length).toBeGreaterThanOrEqual(3);
    expect(undone.addedCards).toBe(0);
    expect(name.value).toBe('');
    expect(email.value).toBe('');
    expect(degree.selectedIndex).toBe(0);
    expect(counts.name).toEqual({ input: 1, change: 1 });
  });

  it('fills the demo form with the sample resume and never ticks the agreement box', async () => {
    const html = readFileSync(join(process.cwd(), 'mobile/demo/form.html'), 'utf8');
    setPage(html.slice(html.indexOf('<body>') + 6, html.indexOf('<script>')));
    const b = await boot();
    b.send({ v: 1, kind: 'needs', reqId: 'n' });
    const needs = (await b.reply('n')) as unknown as { needs: Parameters<typeof buildResumeSubset>[1] };
    b.send({ v: 1, kind: 'fill', reqId: 'f', runId: 'demo', origin: 'https://jobs.example.com', resume: buildResumeSubset(SAMPLE_RESUME_ZH, needs.needs), files: {} });
    const report = (await b.reply('f')) as unknown as { report: { fields: { outcome: string }[] } };
    const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;
    expect(report.report.fields.filter((f) => f.outcome === 'filled').length).toBeGreaterThanOrEqual(10);
    expect(value('name')).toBe('张三');
    expect(value('email')).toBe('zhangsan@example.com');
    expect(value('school-1')).toBe('示例大学');
    expect((document.getElementById('agree') as HTMLInputElement).checked).toBe(false);
  });

  it('a command with v: 2, an unknown kind or bad JSON gets no reply and changes nothing', async () => {
    setPage();
    const b = await boot();
    const before = b.sent.length;
    const subset = buildResumeSubset(resume, computeFrameNeeds(document));
    b.send({ v: 2, kind: 'fill', reqId: 'x1', runId: 'r', resume: subset, files: {} });
    b.send({ v: 1, kind: 'gimme', reqId: 'x2' });
    b.send('{not json');
    b.send(42 as unknown as string);
    await new Promise((r) => setTimeout(r, 50));
    expect(b.sent.length).toBe(before);
    expect((document.getElementById('name') as HTMLInputElement).value).toBe('');
  });

  it('a fill whose payload fails the schema but has a readable reqId answers bad_payload', async () => {
    setPage();
    const b = await boot();
    b.send({ v: 1, kind: 'fill', reqId: 'bad1', runId: 'r', resume: { id: '' }, files: {} });
    expect(await b.reply('bad1')).toEqual({ v: 1, kind: 'error', reqId: 'bad1', code: 'bad_payload' });
    expect((document.getElementById('name') as HTMLInputElement).value).toBe('');
  });

  it('assigns nothing to window', async () => {
    setPage();
    const before = new Set(Object.keys(window));
    await boot();
    const added = Object.keys(window).filter((k) => !before.has(k) && k !== 'rafBridge');
    expect(added).toEqual([]);
  });

  it('says bye on pagehide', async () => {
    setPage();
    const b = await boot();
    window.dispatchEvent(new Event('pagehide'));
    expect(b.msgs().at(-1)).toEqual({ v: 1, kind: 'bye' });
  });
});
