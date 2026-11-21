import { afterEach, describe, expect, it } from 'vitest';
import { highlightRun, runFill, runPreview } from '../../../src/fill/runFill';
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
    expect(value('s2')).toBe('澳大利亚国立大学');
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

  it('uploads files before writing anything else, whatever the page order', async () => {
    document.body.innerHTML = `<form>
      <h2>基本信息</h2><div><label for="nm">姓名</label><input id="nm"></div>
      <h2>附件</h2><div><label for="cv">简历</label><input id="cv" type="file"></div>
    </form>`;
    const order: string[] = [];
    for (const id of ['nm', 'cv']) document.getElementById(id)!.addEventListener('change', () => order.push(id));
    document.getElementById('nm')!.addEventListener('input', () => order.push('nm'));
    const { report } = await runFill(document, { resume: zh, files });
    expect(report.fields.find((f) => f.label === '简历')?.outcome).toBe('filled');
    expect(order[0]).toBe('cv');
    expect(order).toContain('nm');
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
    expect((document.getElementById('vc') as HTMLElement).style.outline).toBe('3px solid #ef4444');
    expect((document.getElementById('g2') as HTMLElement).style.outline).toBe('');
    clearHighlights();
    expect((document.getElementById('nm') as HTMLElement).style.outline).toBe('');
  });
});

describe('a form in several steps', () => {
  const mountSteps = () => {
    document.body.innerHTML = `<form id="f">
      <section id="one"><h2>基本信息</h2>
        <div><label for="nm">姓名</label><input id="nm"></div>
        <button type="button" class="go">下一步</button>
        <button type="button" class="go">Save and Continue</button></section>
      <section id="two" style="display:none"><h2>联系方式</h2>
        <div><label for="em">电子邮箱</label><input id="em"></div>
        <button type="button" class="go">Next</button>
        <button type="submit" class="go">提交申请</button></section>
    </form>`;
    const clicks: string[] = [];
    for (const b of Array.from(document.querySelectorAll<HTMLElement>('.go'))) {
      b.addEventListener('click', () => clicks.push(b.textContent ?? ''));
    }
    let submitted = 0;
    document.querySelector('#f')!.addEventListener('submit', (e) => {
      e.preventDefault();
      submitted += 1;
    });
    const value = (id: string) => document.querySelector<HTMLInputElement>(`#${id}`)!.value;
    return { clicks, value, submitted: () => submitted };
  };

  it('fills only the step on screen and presses nothing to move on', async () => {
    const page = mountSteps();
    await runFill(document, { resume: zh, files });
    expect(page.value('nm')).toBe('林知远');
    expect(page.value('em')).toBe('');
    expect(page.clicks).toEqual([]);
    expect(page.submitted()).toBe(0);
  });

  it('fills the next step once the user has moved there, and leaves the first alone', async () => {
    const page = mountSteps();
    await runFill(document, { resume: zh, files });
    document.querySelector<HTMLElement>('#one')!.style.display = 'none';
    document.querySelector<HTMLElement>('#two')!.style.display = '';
    document.querySelector<HTMLInputElement>('#nm')!.value = '用户改过';
    const second = await runFill(document, { resume: zh, files });
    expect(page.value('em')).toBe(zh.contact.email);
    expect(page.value('nm')).toBe('用户改过');
    expect(second.report.fields.map((f) => f.label)).toEqual(['电子邮箱']);
    expect(page.clicks).toEqual([]);
    expect(page.submitted()).toBe(0);
  });
});

describe('runFill on a page that keeps the file it already holds', () => {
  const en = createSampleProfile().resumes.find((r) => r.id === 'sample-en')!;
  const name = files['sample-resume-en']!.name;

  /** The page, with `held` as the file it shows it has. It takes no new file of that name. */
  function mountHolding(held: string | null, marker = 'data-ui="careers-page-content"'): { box: HTMLInputElement; changes: () => number } {
    document.body.innerHTML = `<main ${marker}><form><div>
      <label for="cv">Resume</label>
      ${held ? `<a aria-label="view ${held}"></a><button type="button" aria-label="delete ${held}"></button>` : ''}
      <input id="cv" data-ui="resume" type="file">
    </div></form></main>`;
    const box = document.getElementById('cv') as HTMLInputElement;
    let changes = 0;
    box.addEventListener('change', () => changes++);
    return { box, changes: () => changes };
  }

  const row = (report: { fields: { label: string; outcome: string; note?: string; value?: string }[] }) =>
    report.fields.find((f) => f.label === 'Resume');

  it('asks instead of reporting filled when the page already holds a file of that name', async () => {
    const { box, changes } = mountHolding(name);
    const { report } = await runFill(document, { resume: en, files });
    expect(row(report)).toMatchObject({ outcome: 'needs_review', note: 'same_file_held', value: name });
    expect(box.files?.length ?? 0).toBe(0);
    expect(changes()).toBe(0);
  });

  it('sends a file of another name, which the page does take', async () => {
    const { box } = mountHolding('Older-Resume.pdf');
    const { report } = await runFill(document, { resume: en, files });
    expect(row(report)).toMatchObject({ outcome: 'filled', value: name });
    expect(row(report)?.note).toBeUndefined();
    expect(box.files?.[0]?.name).toBe(name);
  });

  it('sends the file when the page holds none', async () => {
    const { box } = mountHolding(null);
    const { report } = await runFill(document, { resume: en, files });
    expect(row(report)?.outcome).toBe('filled');
    expect(box.files?.[0]?.name).toBe(name);
  });

  it('looks only at the box being filled, not at another file box on the page', async () => {
    document.body.innerHTML = `<main data-ui="careers-page-content"><form>
      <div><label for="a">Resume</label><input id="a" data-ui="resume" type="file"></div>
      <div><label for="b">Resume</label><button type="button" aria-label="delete ${name}"></button><input id="b" type="file"></div>
    </form></main>`;
    const { report } = await runFill(document, { resume: en, files });
    const boxes = ['a', 'b'].map((id) => document.getElementById(id) as HTMLInputElement);
    expect(boxes[0]!.files?.[0]?.name).toBe(name);
    expect(boxes[1]!.files?.length ?? 0).toBe(0);
    // One resume file goes to one box, so the second box is not a candidate at all.
    expect(report.fields.filter((f) => f.label === 'Resume').map((f) => f.outcome).sort()).toEqual(['filled', 'unmatched']);
  });

  it('still fills the rest of the page after holding a file back, and counts it for review', async () => {
    mountHolding(name);
    document.querySelector('form')!.insertAdjacentHTML('beforeend', '<div><label for="em">Email</label><input id="em" type="email"></div>');
    const { report } = await runFill(document, { resume: en, files });
    expect((document.getElementById('em') as HTMLInputElement).value).toBe(en.contact.email);
    expect(report.counts.needs_review).toBe(1);
    expect(report.counts.filled).toBe(1);
  });

  it('leaves a page without this adapter as it was', async () => {
    const { box } = mountHolding(name, 'class="some-other-site"');
    const { report } = await runFill(document, { resume: en, files });
    expect(row(report)?.outcome).toBe('filled');
    expect(box.files?.[0]?.name).toBe(name);
  });
});

describe('runFill on entries the page already holds', () => {
  /** The resume's schools under made-up names; the page lists them under other wording. */
  const aliased = structuredClone(zh);
  aliased.education[0] = { ...aliased.education[0]!, school: '星河理工大学', schoolEn: 'Xinghe University of Technology', major: '示例工程' };
  aliased.education[1] = { ...aliased.education[1]!, school: '晨光师范大学', schoolEn: 'Chenguang Normal University', major: '示例科学' };

  const selectCard = (n: number) => `
    <div class="entry"><h4>教育经历 ${n}</h4>
      <div class="row"><label for="s${n}">学校名称</label><select id="s${n}">
        <option value="">请选择</option><option>星河理工大学（XHU）</option><option>晨光师范</option><option>他人大学</option>
      </select></div>
      <div class="row"><label for="m${n}">专业</label><input id="m${n}"></div>
    </div>`;

  function mountSelects(): { clicks: string[] } {
    document.body.innerHTML = `<form id="f">
      <h2>教育经历</h2><div id="edu">${selectCard(1)}</div>
      <button type="button" id="add">添加教育经历</button>
    </form>`;
    const clicks: string[] = [];
    document.getElementById('add')!.addEventListener('click', () => {
      clicks.push('add');
      document.getElementById('edu')!.insertAdjacentHTML('beforeend', selectCard(document.getElementById('edu')!.children.length + 1));
    });
    return { clicks };
  }

  const picked = (id: string) => {
    const select = document.getElementById(id) as HTMLSelectElement;
    return select.options[select.selectedIndex]?.text ?? '';
  };
  const idsOf = (idFor: (el: HTMLElement) => string, ...ids: string[]) => ids.map((id) => idFor(document.getElementById(id)!));
  const stableIds = () => {
    const ids = new WeakMap<HTMLElement, string>();
    let n = 0;
    return (el: HTMLElement) => ids.get(el) ?? (ids.set(el, `h${++n}`), ids.get(el)!);
  };

  it('a second run takes a school it picked under the page’s wording as in place, and adds no card', async () => {
    const { clicks } = mountSelects();
    await runFill(document, { resume: aliased, files });
    expect([picked('s1'), picked('s2')]).toEqual(['星河理工大学（XHU）', '晨光师范']);
    await runFill(document, { resume: aliased, files });
    expect(document.querySelectorAll('#edu .entry')).toHaveLength(2);
    expect(clicks).toEqual(['add']);
    expect([picked('s1'), picked('s2')]).toEqual(['星河理工大学（XHU）', '晨光师范']);
  });

  it('a school the resume does not have is still someone’s own entry, and the resume’s go to new cards', async () => {
    const { clicks } = mountSelects();
    (document.getElementById('s1') as HTMLSelectElement).selectedIndex = 3;
    await runFill(document, { resume: aliased, files });
    expect(clicks).toEqual(['add', 'add']);
    expect([picked('s1'), picked('s2'), picked('s3')]).toEqual(['他人大学', '星河理工大学（XHU）', '晨光师范']);
  });

  it('reports every field of a card it leaves alone, as an entry already there', async () => {
    mount();
    (document.getElementById('s1') as HTMLInputElement).value = '他人大学';
    const idFor = stableIds();
    const { report } = await runFill(document, { resume: zh, files }, { idFor });
    expect(value('s1')).toBe('他人大学');
    const held = idsOf(idFor, 's1', 'm1', 'g1').map((id) => report.fields.find((f) => f.fieldId === id));
    for (const row of held) expect(row).toMatchObject({ outcome: 'no_data', note: 'entry_held', section: 'education' });
    expect(Object.values(report.counts).reduce((a, b) => a + b, 0)).toBe(report.fields.length);
  });

  it('the preview plans the same cards as the fill', async () => {
    mount();
    document.getElementById('edu')!.insertAdjacentHTML('beforeend', card(2));
    (document.getElementById('s1') as HTMLInputElement).value = '他人大学';
    const idFor = stableIds();
    const preview = runPreview(document, { resume: zh, files }, { idFor });
    const [s1, m1, g1, s2, m2] = idsOf(idFor, 's1', 'm1', 'g1', 's2', 'm2');
    const planned = new Map(preview.items.map((i) => [i.fieldId, i.value]));
    for (const id of [s1, m1, g1]) expect(planned.has(id!), id).toBe(false);
    expect(planned.get(s2!)).toBe('浙江大学');
    expect(planned.get(m2!)).toBe('计算机科学与技术');
    expect(preview.cardDemand).toEqual([{ section: 'education', have: 1, need: 2 }]);

    const { report } = await runFill(document, { resume: zh, files }, { idFor });
    for (const [id, shown] of planned) {
      const row = report.fields.find((f) => f.fieldId === id);
      expect(row?.value, id).toBe(shown);
    }
    expect(value('s2')).toBe('浙江大学');
  });
});
