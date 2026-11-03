import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureCards, findAddButtons } from '../../../src/fill/ensureCards';
import { createSampleProfile } from '../../../src/schema';

const zh = createSampleProfile().resumes.find((r) => r.id === 'sample-zh')!;

afterEach(() => {
  document.body.innerHTML = '';
});

const eduCard = (n: number) => `
  <div class="entry"><h4>教育经历 ${n}</h4>
    <div class="row"><label for="s${n}">学校名称</label><input id="s${n}"></div>
    <div class="row"><label for="d${n}">学历</label><input id="d${n}"></div>
    <div class="row"><label for="m${n}">专业</label><input id="m${n}"></div>
    <button type="button" class="del">删除</button>
  </div>`;
const internCard = (n: number) => `
  <div class="entry"><h4>实习经历 ${n}</h4>
    <div class="row"><label for="c${n}">公司名称</label><input id="c${n}"></div>
    <div class="row"><label for="p${n}">职位名称</label><input id="p${n}"></div>
    <div class="row"><label for="w${n}">工作内容</label><textarea id="w${n}"></textarea></div>
  </div>`;

interface Page {
  clicks: string[];
}

/** Education (1 card, "+ 添加教育经历" appends) and internship (0 cards, "添加实习经历" appends). */
function mount(opts: { eduButton?: boolean; internButton?: boolean; eduWorks?: boolean } = {}): Page {
  const { eduButton = true, internButton = true, eduWorks = true } = opts;
  document.body.innerHTML = `<form id="f">
    <h2>基本信息</h2><div><label for="nm">姓名</label><input id="nm"><label for="em">邮箱</label><input id="em"></div>
    <h2>教育经历</h2>
    <div id="edu">${eduCard(1)}</div>
    ${eduButton ? '<button type="button" id="add-edu">+ 添加教育经历</button>' : ''}
    <h2>实习经历</h2>
    <div id="intern"></div>
    ${internButton ? '<button type="button" id="add-intern">添加实习经历</button>' : ''}
    <button type="submit" id="submit">提交</button>
    <button type="button" id="next">下一步</button>
  </form>`;
  const page: Page = { clicks: [] };
  const edu = document.getElementById('edu')!;
  const intern = document.getElementById('intern')!;
  document.getElementById('add-edu')?.addEventListener('click', () => {
    page.clicks.push('add-edu');
    if (eduWorks) edu.insertAdjacentHTML('beforeend', eduCard(edu.children.length + 1));
  });
  document.getElementById('add-intern')?.addEventListener('click', () => {
    page.clicks.push('add-intern');
    intern.insertAdjacentHTML('beforeend', internCard(intern.children.length + 1));
  });
  for (const id of ['submit', 'next']) document.getElementById(id)!.addEventListener('click', () => page.clicks.push(id));
  document.querySelectorAll('.del').forEach((b) => b.addEventListener('click', () => page.clicks.push('delete')));
  document.getElementById('f')!.addEventListener('submit', (e) => {
    e.preventDefault();
    page.clicks.push('form-submit');
  });
  return page;
}

describe('findAddButtons', () => {
  it('assigns sections by own text or enclosing heading and skips delete / submit / next', () => {
    mount();
    const found = findAddButtons(document).map((b) => [b.text, b.section, b.named]);
    expect(found).toEqual([
      ['+ 添加教育经历', 'education', true],
      ['添加实习经历', 'internship', true],
    ]);
  });

  it('falls back to the heading for a bare "Add another"', () => {
    document.body.innerHTML = `<h2>Employment</h2><div><label>Job<input></label><label>Company<input></label></div>
      <button type="button">+ Add another</button>`;
    expect(findAddButtons(document).map((b) => [b.section, b.named])).toEqual([['work', false]]);
  });

  it('ignores hidden and disabled add buttons', () => {
    document.body.innerHTML = `<h2>教育经历</h2><button type="button" disabled>添加教育经历</button>
      <button type="button" style="display:none">添加教育经历</button><button type="button" aria-disabled="true">添加教育经历</button>`;
    expect(findAddButtons(document)).toEqual([]);
  });
});

describe('ensureCards', () => {
  it('clicks the add button until every section has one card per resume entry', async () => {
    const page = mount();
    const results = await ensureCards(document, zh, { timeoutMs: 500 });
    expect(document.querySelectorAll('#edu .entry')).toHaveLength(2);
    expect(document.querySelectorAll('#intern .entry')).toHaveLength(2);
    expect(page.clicks.filter((c) => c === 'add-edu')).toHaveLength(1);
    expect(page.clicks.filter((c) => c === 'add-intern')).toHaveLength(2);
    expect(results.find((r) => r.section === 'education')).toMatchObject({ added: 1, status: 'ok', have: 2, need: 2 });
    expect(results.find((r) => r.section === 'internship')).toMatchObject({ added: 2, status: 'ok', need: 2 });
  });

  it('never clicks submit, next or delete buttons and never submits the form', async () => {
    const page = mount();
    await ensureCards(document, zh, { timeoutMs: 500 });
    expect(page.clicks.filter((c) => !c.startsWith('add-'))).toEqual([]);
  });

  it('reports no_button when a section cannot grow, without clicking anything for it', async () => {
    const page = mount({ eduButton: false });
    const results = await ensureCards(document, zh, { timeoutMs: 500 });
    expect(results.find((r) => r.section === 'education')).toMatchObject({ status: 'no_button', added: 0, have: 1 });
    expect(page.clicks).not.toContain('add-edu');
    expect(document.querySelectorAll('#intern .entry')).toHaveLength(2);
  });

  it('reports action_failed when the click adds nothing, after a single attempt', async () => {
    const page = mount({ eduWorks: false });
    const results = await ensureCards(document, zh, { timeoutMs: 120 });
    expect(results.find((r) => r.section === 'education')).toMatchObject({ status: 'action_failed', added: 0 });
    expect(page.clicks.filter((c) => c === 'add-edu')).toHaveLength(1);
  });

  it('does nothing when the page already has enough cards', async () => {
    document.body.innerHTML = `<h2>教育经历</h2>${eduCard(1)}${eduCard(2)}<button type="button">添加教育经历</button>`;
    const spy = vi.fn();
    document.querySelector('button')!.addEventListener('click', spy);
    expect(await ensureCards(document, zh, { timeoutMs: 100 })).toEqual([]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('stops piling up blocks when added fields never form a recognisable card', async () => {
    document.body.innerHTML = `<h2>教育经历</h2><div id="edu">${eduCard(1)}</div>
      <button type="button" id="add">添加教育经历</button>`;
    // Each click only adds one stray input: the card count does not grow.
    document.getElementById('add')!.addEventListener('click', () => {
      const i = document.createElement('input');
      document.body.append(i);
    });
    const results = await ensureCards(document, zh, { timeoutMs: 200 });
    expect(results[0]).toMatchObject({ section: 'education', status: 'action_failed' });
    expect(results[0]!.added).toBeLessThanOrEqual(1);
  });

  it('keeps a type-less add button inside a form from submitting it', async () => {
    document.body.innerHTML = `<form id="f"><h2>教育经历</h2><div id="edu">${eduCard(1)}</div>
      <button id="add">+ 添加教育经历</button></form>`;
    const submits = vi.fn();
    document.getElementById('f')!.addEventListener('submit', (e) => submits(e.defaultPrevented), { once: false });
    document.getElementById('add')!.addEventListener('click', () => {
      document.getElementById('edu')!.insertAdjacentHTML('beforeend', eduCard(2));
    });
    await ensureCards(document, zh, { timeoutMs: 300 });
    expect(document.querySelectorAll('#edu .entry')).toHaveLength(2);
    // The implicit submit may fire, but it is always cancelled before it reaches the browser.
    for (const call of submits.mock.calls) expect(call[0]).toBe(true);
  });

  it('never lets an untyped add button in a form run the page submit handlers (I1)', async () => {
    document.body.innerHTML = `<form id="f"><h2>教育经历</h2><div id="edu">${eduCard(1)}</div>
      <button id="add">+ 添加教育经历</button></form>`;
    const ran: string[] = [];
    const watch = (name: string, target: EventTarget, capture: boolean) =>
      target.addEventListener('submit', () => ran.push(name), capture);
    watch('form-bubble', document.getElementById('f')!, false);
    watch('form-capture', document.getElementById('f')!, true);
    watch('doc-capture', document, true);
    watch('doc-bubble', document, false);
    watch('win-bubble', window, false);
    let defaultPrevented = true;
    document.getElementById('f')!.addEventListener('submit', (e) => (defaultPrevented = e.defaultPrevented));
    document.getElementById('add')!.addEventListener('click', () => {
      document.getElementById('edu')!.insertAdjacentHTML('beforeend', eduCard(2));
    });
    const results = await ensureCards(document, zh, { timeoutMs: 300 });
    expect(document.querySelectorAll('#edu .entry')).toHaveLength(2); // the button was a genuine add button
    expect(results.find((r) => r.section === 'education')).toMatchObject({ status: 'ok', added: 1 });
    expect(ran).toEqual([]);
    expect(defaultPrevented).toBe(true);

    // The guard is gone afterwards: a real submit event reaches the page again.
    document.getElementById('f')!.dispatchEvent(new Event('submit', { cancelable: true }));
    expect(ran).toContain('form-bubble');
  });

  it('does not click an add link that navigates, but accepts "#" and javascript:void(0) links (I1)', async () => {
    document.body.innerHTML = `<h2>教育经历</h2><div id="edu">${eduCard(1)}</div>
      <a id="real" href="/resume/add-education">添加教育经历</a>
      <a id="abs" href="https://example.com/add">添加教育经历</a>`;
    const clicked: string[] = [];
    for (const id of ['real', 'abs']) document.getElementById(id)!.addEventListener('click', () => clicked.push(id));
    expect(findAddButtons(document)).toEqual([]);
    const results = await ensureCards(document, zh, { timeoutMs: 100 });
    expect(results.find((r) => r.section === 'education')).toMatchObject({ status: 'no_button', added: 0 });
    expect(clicked).toEqual([]);

    for (const href of ['#', '#add', 'javascript:void(0)', 'javascript:;', 'JavaScript: void 0', '']) {
      document.body.innerHTML = `<h2>教育经历</h2><div id="edu">${eduCard(1)}</div><a href="${href}">添加教育经历</a>`;
      expect(findAddButtons(document).map((b) => b.section), href).toEqual(['education']);
    }
    document.body.innerHTML = `<h2>教育经历</h2><div id="edu">${eduCard(1)}</div><a>添加教育经历</a>`;
    expect(findAddButtons(document)).toHaveLength(1);
  });

  it('skips explicit submit buttons even when their text says "add"', () => {
    document.body.innerHTML = `<form><h2>教育经历</h2><button type="submit">添加教育经历</button>
      <button type="SUBMIT">添加教育经历</button></form>`;
    expect(findAddButtons(document)).toEqual([]);
  });

  it('reports action_failed when the maxAdds cap ends the loop before reaching need (M5)', async () => {
    mount();
    const results = await ensureCards(document, zh, { timeoutMs: 500, maxAdds: 1 });
    const intern = results.find((r) => r.section === 'internship')!;
    expect(intern).toMatchObject({ added: 1, have: 1, need: 2, status: 'action_failed' });
    // A cap that is reached exactly when the section is complete is still a success.
    document.body.innerHTML = '';
    mount();
    const exact = await ensureCards(document, zh, { timeoutMs: 500, maxAdds: 2 });
    expect(exact.find((r) => r.section === 'internship')).toMatchObject({ added: 2, have: 2, status: 'ok' });
  });
});