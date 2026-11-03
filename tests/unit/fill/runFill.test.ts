import { afterEach, describe, expect, it } from 'vitest';
import { highlightRun, runFill } from '../../../src/fill/runFill';
import { clearHighlights } from '../../../src/fill/highlight';
import { createSampleFiles, createSampleProfile } from '../../../src/schema';

const zh = createSampleProfile().resumes.find((r) => r.id === 'sample-zh')!;
const files = createSampleFiles();

afterEach(() => {
  clearHighlights();
  document.body.innerHTML = '';
});

const card = (n: number) => `
  <div class="entry"><h4>教育经历 ${n}</h4>
    <div class="row"><label for="s${n}">学校名称</label><input id="s${n}"></div>
    <div class="row"><label for="m${n}">专业</label><input id="m${n}"></div>
    <div class="row"><label for="g${n}">GPA</label><input id="g${n}"></div>
  </div>`;

function mount(): { clicks: string[] } {
  document.body.innerHTML = `<form id="f">
    <h2>基本信息</h2>
    <div><label for="nm">姓名</label><input id="nm"><label for="em">电子邮箱</label><input id="em">
      <label for="vc">验证码</label><input id="vc"></div>
    <h2>教育经历</h2><div id="edu">${card(1)}</div>
    <button type="button" id="add">添加教育经历</button>
    <button type="submit" id="submit">提交申请</button>
  </form>`;
  const clicks: string[] = [];
  document.getElementById('add')!.addEventListener('click', () => {
    clicks.push('add');
    document.getElementById('edu')!.insertAdjacentHTML('beforeend', card(document.getElementById('edu')!.children.length + 1));
  });
  document.getElementById('submit')!.addEventListener('click', () => clicks.push('submit'));
  return { clicks };
}

const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

describe('runFill', () => {
  it('adds the missing card, fills every card from its own entry and reports counts', async () => {
    const { clicks } = mount();
    const { report, controls } = await runFill(document, { resume: zh, files });
    expect(value('nm')).toBe('林知远');
    expect(value('em')).toBe('zhiyuan.lin@example.com');
    expect(value('s1')).toBe('浙江大学');
    expect(value('s2')).toBe('昆士兰大学');
    expect(value('m2')).toBe('计算机科学');
    expect(value('g1')).toBe('3.8');
    expect(value('g2')).toBe(''); // no data for entry 2
    expect(clicks).toEqual(['add']);
    expect(report.counts.filled).toBeGreaterThanOrEqual(7);
    expect(report.counts.no_data).toBe(1);
    expect(Object.values(report.counts).reduce((a, b) => a + b, 0)).toBe(report.fields.length);
    expect(report.finishedAt).toBeGreaterThanOrEqual(report.startedAt);
    // controls: fieldId → Control of the final scan, one per report row.
    for (const f of report.fields) expect(controls.get(f.fieldId)?.el.isConnected, f.fieldId).toBe(true);
    expect(controls.get(report.fields.find((f) => f.label === '姓名')!.fieldId)?.el).toBe(document.getElementById('nm'));
  });

  it('leaves an unrecognised field (verification code) empty and reports it unmatched', async () => {
    mount();
    const { report } = await runFill(document, { resume: zh, files });
    expect(value('vc')).toBe('');
    expect(report.fields.find((f) => f.label === '验证码')?.outcome).toBe('unmatched');
  });

  it('honours opts.idFor so ids are stable across runs', async () => {
    mount();
    const ids = new WeakMap<HTMLElement, string>();
    let n = 100;
    const idFor = (el: HTMLElement) => ids.get(el) ?? (ids.set(el, `x${++n}`), ids.get(el)!);
    const first = await runFill(document, { resume: zh, files }, { idFor });
    const second = await runFill(document, { resume: zh, files }, { idFor });
    expect([...first.controls.keys()].every((k) => k.startsWith('x'))).toBe(true);
    expect([...second.controls.keys()]).toEqual([...first.controls.keys()]);
  });

  it('never clicks the submit button', async () => {
    const { clicks } = mount();
    await runFill(document, { resume: zh, files });
    expect(clicks).not.toContain('submit');
  });

  it('highlightRun outlines filled fields and skips fields without a control', async () => {
    mount();
    const run = await runFill(document, { resume: zh, files });
    highlightRun(run);
    expect((document.getElementById('nm') as HTMLElement).style.outline).toBe('2px solid #22c55e');
    expect((document.getElementById('vc') as HTMLElement).style.outline).toBe('2px solid #ef4444');
    expect((document.getElementById('g2') as HTMLElement).style.outline).toBe('');
    clearHighlights();
    expect((document.getElementById('nm') as HTMLElement).style.outline).toBe('');
  });
});
