import { afterEach, describe, expect, it, vi } from 'vitest';
import { highlightRun, runFill, runPreview, sameAnswer } from '../../../src/fill/runFill';
import type { FillIntent } from '../../../src/drivers/types';
import { clearHighlights } from '../../../src/fill/highlight';
import { createSampleFiles, createSampleProfile } from '../../../src/schema';
import { mselect } from '../../shared/feishuMobileForm';

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

  it('puts the portfolio file in the portfolio box and the resume in the resume box', async () => {
    document.body.innerHTML = `<form><h2>附件</h2>
      <div><label for="cv">简历附件</label><input id="cv" type="file"></div>
      <div><label for="wk">作品附件</label><input id="wk" type="file"></div></form>`;
    const works = { ...files, 'my-works': { ...files['sample-resume-zh']!, name: '作品集.pdf' } };
    const resume = { ...zh, attachments: { ...zh.attachments, portfolioFileId: 'my-works' } };
    const { report } = await runFill(document, { resume, files: works });
    const name = (id: string) => (document.getElementById(id) as HTMLInputElement).files?.[0]?.name;
    expect(name('cv')).toBe('林知远-简历.pdf');
    expect(name('wk')).toBe('作品集.pdf');
    expect(report.fields.find((f) => f.label === '作品附件')).toMatchObject({ outcome: 'filled', fieldKey: 'attachments.portfolio' });
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

describe('runFill: what became of each entry', () => {
  /** The sample resume with made-up schools. */
  const named = structuredClone(zh);
  named.education[0] = { ...named.education[0]!, school: '星河示例理工大学', schoolEn: '' };
  named.education[1] = { ...named.education[1]!, school: '云岭示例大学', schoolEn: '' };

  it('reports the card the page had and the card it added, each with its school, and numbers every field by entry', async () => {
    mount();
    const ids = new WeakMap<HTMLElement, string>();
    let n = 0;
    const idFor = (el: HTMLElement) => ids.get(el) ?? (ids.set(el, `e${++n}`), ids.get(el)!);
    const { report } = await runFill(document, { resume: named, files }, { idFor });
    expect(report.entries).toEqual([
      { section: 'education', index: 0, state: 'existing', label: '星河示例理工大学' },
      { section: 'education', index: 1, state: 'added', label: '云岭示例大学' },
    ]);
    const row = (id: string) => report.fields.find((f) => f.fieldId === idFor(document.getElementById(id)!));
    expect(row('s1')).toMatchObject({ section: 'education', entry: 0 });
    expect(row('g2')).toMatchObject({ outcome: 'no_data', section: 'education', entry: 1 });
    expect(row('nm')?.entry).toBeUndefined();
  });

  it('says an entry was skipped because pressing the add button brought no new card', async () => {
    mount();
    const add = document.getElementById('add')!;
    add.replaceWith(add.cloneNode(true)); // the same button, with nothing behind it
    const { report } = await runFill(document, { resume: named, files });
    expect(report.entries).toEqual([
      { section: 'education', index: 0, state: 'existing', label: '星河示例理工大学' },
      { section: 'education', index: 1, state: 'skipped', reason: 'add_failed', label: '云岭示例大学', button: '添加教育经历' },
    ]);
  });

  it('says an entry was skipped because the page has no add button for it', async () => {
    mount();
    document.getElementById('add')!.remove();
    const { report } = await runFill(document, { resume: named, files });
    expect(report.entries?.[1]).toEqual({ section: 'education', index: 1, state: 'skipped', reason: 'no_button', label: '云岭示例大学' });
  });

  it('counts the fields of a section with one ungrouped card as its first entry', async () => {
    document.body.innerHTML = `<form><h2>教育经历</h2>
      <div><label for="s">学校名称</label><input id="s"></div><div><label for="m">专业</label><input id="m"></div></form>`;
    const { report } = await runFill(document, { resume: named, files });
    const school = report.fields.find((f) => f.label === '学校名称');
    expect(school).toMatchObject({ outcome: 'filled', section: 'education', entry: 0 });
    expect(report.entries?.[0]).toEqual({ section: 'education', index: 0, state: 'existing', label: '星河示例理工大学' });
  });

  it('says which entries the page already showed, and leaves them alone', async () => {
    mount();
    document.getElementById('edu')!.insertAdjacentHTML('beforeend', card(2));
    (document.getElementById('s1') as HTMLInputElement).value = '云岭示例大学';
    const { report } = await runFill(document, { resume: named, files });
    expect(report.entries).toEqual([
      { section: 'education', index: 0, state: 'existing', label: '星河示例理工大学' },
      { section: 'education', index: 1, state: 'held', label: '云岭示例大学' },
    ]);
    expect(value('s2')).toBe('星河示例理工大学');
    // The held card's rows name the entry they show.
    expect(report.fields.filter((f) => f.note === 'entry_held').every((f) => f.entry === 1)).toBe(true);
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

describe('runFill on a page that takes a file into its own list and empties the box', () => {
  const en = createSampleProfile().resumes.find((r) => r.id === 'sample-en')!;
  const name = files['sample-resume-en']!.name;

  /**
   * Personio's box: on change it puts a fresh input where the old one was, and a render later lists the file with a
   * Remove button.
   */
  function mountTaking(takes: boolean, withAdapter = true): void {
    document.body.innerHTML = `<form><div role="group" aria-labelledby="doc-label-cv">
      <div id="doc-label-cv">CV</div>
      <div><div role="list"></div><button type="button">Add file</button>
      <input id="doc-input-cv" type="file" aria-label="Upload CV" name="${withAdapter ? 'documents.cv' : 'cv'}"></div>
    </div></form>`;
    const list = document.querySelector('[role="list"]')!;
    // On the form, as React listens: every input the page puts in its place behaves the same.
    document.querySelector('form')!.addEventListener('change', (e) => {
      const box = e.target as HTMLInputElement;
      const file = box.files?.[0];
      if (takes && file) {
        // Well past the driver's own wait for the box: only the list tells that the file went in.
        setTimeout(() => {
          list.innerHTML = `<div role="listitem"><span>${file.name}</span><button type="button" aria-label="Remove ${file.name}">x</button></div>`;
        }, 1500);
      }
      box.replaceWith(box.cloneNode());
    });
  }

  const row = (report: { fields: { label: string; outcome: string; observed?: string | null }[] }) =>
    report.fields.find((f) => /^CV/.test(f.label));

  it('reports the file filled once the page lists it', async () => {
    mountTaking(true);
    const { report } = await runFill(document, { resume: en, files });
    expect(row(report)).toMatchObject({ outcome: 'filled', observed: name });
  });

  it('still reports a failure when the page lists nothing', async () => {
    mountTaking(false);
    const { report } = await runFill(document, { resume: en, files });
    expect(row(report)?.outcome).toBe('action_failed');
  });

  it('needs the adapter to read a list as the page holding the file', async () => {
    mountTaking(true, false);
    const { report } = await runFill(document, { resume: en, files });
    expect(row(report)?.outcome).toBe('action_failed');
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

  it('asks the user to confirm a school picked from the site’s options under another name, and says what was picked', async () => {
    mountSelects();
    const idFor = stableIds();
    const { report } = await runFill(document, { resume: aliased, files }, { idFor });
    const [s1, s2] = idsOf(idFor, 's1', 's2').map((id) => report.fields.find((f) => f.fieldId === id));
    expect(s1).toMatchObject({ outcome: 'needs_review', note: 'picked_other_name', value: '星河理工大学', observed: '星河理工大学（XHU）', entry: 0 });
    expect(s2).toMatchObject({ outcome: 'needs_review', note: 'picked_other_name', observed: '晨光师范', entry: 1 });
    // The pick stays on the page: the user confirms it, or changes it.
    expect(picked('s1')).toBe('星河理工大学（XHU）');
  });

  it('reports a school written on the site’s list exactly as the resume writes it as filled', async () => {
    mountSelects();
    document.querySelectorAll('#edu option').forEach((o) => {
      if (o.textContent === '他人大学') o.textContent = '星河理工大学';
    });
    const idFor = stableIds();
    const { report } = await runFill(document, { resume: aliased, files }, { idFor });
    const s1 = report.fields.find((f) => f.fieldId === idsOf(idFor, 's1')[0]);
    expect(s1).toMatchObject({ outcome: 'filled', observed: '星河理工大学' });
    expect(s1?.note).toBeUndefined();
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

// An identity number is written only when the applicant chose to; by default the box stays empty and the row says why.
describe('runFill and a sensitive field', () => {
  const mountId = () => {
    document.body.innerHTML = `<form><h2>基本信息</h2>
      <div><label for="nm">姓名</label><input id="nm"></div>
      <div><label for="idn">身份证号</label><input id="idn"></div></form>`;
  };

  it('leaves the identity number empty by default and reminds the applicant', async () => {
    mountId();
    const { report } = await runFill(document, { resume: zh, files });
    expect(value('nm')).toBe('林知远');
    expect(value('idn')).toBe('');
    const row = report.fields.find((f) => f.label === '身份证号');
    expect(row).toMatchObject({ fieldKey: 'basics.idNumber', outcome: 'needs_review', note: 'sensitive_held' });
    expect(row?.value).toBeUndefined();
  });

  it('fills it when the applicant chose to, and the row says it was a sensitive field', async () => {
    mountId();
    const { report } = await runFill(document, { resume: zh, files, sensitiveFields: 'fill' });
    expect(value('idn')).toBe(zh.basics.idNumber);
    expect(report.fields.find((f) => f.label === '身份证号')).toMatchObject({
      fieldKey: 'basics.idNumber',
      outcome: 'filled',
      note: 'sensitive_filled',
    });
  });
});

// A page that opens with the applicant's earlier answers (Feishu fills a form from the last application): an answer
// already there is theirs to change, so it stays, and the row says what the resume has instead.
describe('runFill on a page that already holds answers', () => {
  const preset = (id: string, text: string) => ((document.getElementById(id) as HTMLInputElement).value = text);
  const row = <T extends { label?: string }>(fields: T[], label: string): T => fields.find((f) => f.label === label)!;
  /** The form of mount() with a question beside the name that only the applicant answers. */
  const mountWithStart = () => {
    mount();
    document.getElementById('vc')!.insertAdjacentHTML('afterend', '<label for="av">预计入职时间</label><input id="av">');
  };

  const pickerRow = (title: string, control: string) =>
    `<div class="atsx-row atsx-form-item"><div class="atsx-form-item-control"><span class="atsx-form-item-children"><div class="atsx-col atsx-form-item-label"><label title="${title}">${title}</label></div></span></div><div class="atsx-col atsx-form-item-control-wrapper">${control}</div></div>`;
  const FULL_TIME = '是否为全日制在校学生';

  it('keeps a picker that holds an answer of the applicant’s own, and asks about it', async () => {
    mount();
    document.getElementById('vc')!.insertAdjacentHTML('afterend', pickerRow(FULL_TIME, mselect('是', ['是', '否'])));
    const { report } = await runFill(document, { resume: zh, files });
    expect(document.querySelector('.atsx-mselect-mSelect-content')!.textContent).toBe('是');
    expect(row(report.fields, FULL_TIME)).toMatchObject({ outcome: 'needs_review', observed: '是', note: 'answer_held' });
  });

  // The resume says fluent; the list words it 无障碍沟通. Already the resume's answer, in the list's own words.
  it('a picker already on the option the resume’s answer picks counts as filled', async () => {
    mount();
    const languages = `<h2>语言能力</h2><div>${pickerRow('语言', mselect('英语', ['英语', '日语']))}${pickerRow('精通程度', mselect('无障碍沟通', ['一般', '良好', '无障碍沟通', '母语']))}</div>`;
    document.getElementById('add')!.insertAdjacentHTML('afterend', languages);
    const { report } = await runFill(document, { resume: zh, files });
    expect(row(report.fields, '精通程度')).toMatchObject({ outcome: 'filled' });
  });

  // A plain list shows its first option before anyone picks one: that is no answer of the applicant's.
  it('fills a plain list that only shows its first option', async () => {
    mount();
    document.getElementById('vc')!.insertAdjacentHTML('afterend', `<label for="ft">${FULL_TIME}</label><select id="ft"><option>是</option><option>否</option></select>`);
    const { report } = await runFill(document, { resume: zh, files });
    expect(value('ft')).toBe('否');
    expect(row(report.fields, FULL_TIME).outcome).toBe('filled');
  });

  it('says it is still at work after each box it fills', async () => {
    mountWithStart();
    const onProgress = vi.fn();
    const { report } = await runFill(document, { resume: zh, files }, { onProgress });
    const done = report.fields.filter((f) => f.outcome === 'filled').length;
    expect(done).toBeGreaterThan(1);
    expect(onProgress.mock.calls.length).toBeGreaterThanOrEqual(done);
  });

  it('keeps an answer of its own and asks about it, and fills the empty boxes beside it', async () => {
    mountWithStart();
    preset('av', '2026.12-');
    const { report } = await runFill(document, { resume: zh, files });
    expect(value('av')).toBe('2026.12-');
    expect(value('nm')).toBe('林知远');
    expect(row(report.fields, '预计入职时间')).toMatchObject({ outcome: 'needs_review', observed: '2026.12-', note: 'answer_held' });
  });

  // A site writes the account's name, phone and email, or a city it guessed, into a fresh form: not the applicant's
  // answer to this one, so the resume's goes in.
  it('writes over what a site brings from the account: the name and how to reach the applicant', async () => {
    mountWithStart();
    preset('nm', '王小明');
    preset('em', 'account@example.com');
    const { report } = await runFill(document, { resume: zh, files });
    expect(value('nm')).toBe('林知远');
    expect(value('em')).toBe('zhiyuan.lin@example.com');
    expect(row(report.fields, '姓名').outcome).toBe('filled');
  });

  it('an answer that is already the resume’s counts as filled', async () => {
    mountWithStart();
    preset('av', '2026-07');
    const { report } = await runFill(document, { resume: zh, files });
    expect(row(report.fields, '预计入职时间').outcome).toBe('filled');
  });

  it('writes over it when the applicant chose a value for that box in the preview', async () => {
    mountWithStart();
    preset('av', '2026.12-');
    const preview = runPreview(document, { resume: zh, files }, { idFor: (el) => el.id });
    const start = preview.items.find((i) => i.label === '预计入职时间')!;
    await runFill(document, { resume: zh, files }, { idFor: (el) => el.id, filter: { excludedFieldIds: [], overrides: { [start.fieldId]: '2026-07' } } });
    expect(value('av')).toBe('2026-07');
  });
});

// A list a library draws shows its picks in its own way: a cascader's path with slashes, a multi-select's picks with
// commas. A second fill must know its own answer from the first, so these are the resume's answer, not the applicant's.
describe('sameAnswer', () => {
  const cascade: FillIntent = { kind: 'cascade', display: '浙江省杭州市', path: ['浙江省', '杭州市'] };
  const multi: FillIntent = {
    kind: 'multi',
    display: '深圳、杭州',
    items: ['深圳', '杭州'].map((query) => ({ query, match: () => ({ status: 'none' as const }) })) as never,
  };

  it('takes a cascader path written with slashes as the same place', () => {
    expect(sameAnswer(cascade, '浙江省 / 杭州市')).toBe(true);
    expect(sameAnswer(cascade, '浙江省/杭州市')).toBe(true);
  });

  it('does not take another city of the same province', () => {
    expect(sameAnswer(cascade, '浙江省 / 宁波市')).toBe(false);
  });

  it('takes the same picks in any order and with any separator', () => {
    expect(sameAnswer(multi, '深圳, 杭州')).toBe(true);
    expect(sameAnswer(multi, '杭州，深圳')).toBe(true);
  });

  it('does not take only some of the picks', () => {
    expect(sameAnswer(multi, '深圳')).toBe(false);
    expect(sameAnswer(multi, '深圳, 杭州, 上海')).toBe(false);
  });
});
