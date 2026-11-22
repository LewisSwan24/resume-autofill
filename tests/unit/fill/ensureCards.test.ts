import { afterEach, describe, expect, it, vi } from 'vitest';
import { ensureCards, findAddButtons } from '../../../src/fill/ensureCards';
import { createSampleProfile } from '../../../src/schema';
import { BEISEN_FORM } from '../../shared/beisenForm';
import { FEISHU_DESKTOP_ENTRIES } from '../../shared/feishuDesktopForm';
import { mperiod, mschool, mselect } from '../../shared/feishuMobileForm';

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

  // Beisen draws its add button as a span in two divs, every one of them showing the pointer.
  const plainAdd = (words: string, pointer = true) => {
    const cursor = pointer ? ' style="cursor:pointer"' : '';
    return `<div class="sc-a"${cursor}><div class="sc-b"${cursor}><svg class="icon"></svg><span${cursor}>${words}</span></div></div>`;
  };

  it('finds an add button that is only words on something shown as clickable, once', () => {
    document.body.innerHTML = `<h2>项目经历</h2><div><label>项目名称<input></label><label>项目描述<textarea></textarea></label></div>${plainAdd('添加')}`;
    const found = findAddButtons(document);
    expect(found.map((b) => [b.text, b.section, b.named])).toEqual([['添加', 'projects', false]]);
  });

  // The pointer is inherited, so it does not say which wrapper listens. A click only travels up: it has to start
  // at the words, so that a handler on any of the wrappers hears it.
  it('a click on the add button it found reaches a handler on any wrapper of the words', () => {
    document.body.innerHTML = `<h2>项目经历</h2><div><label>项目名称<input></label><label>项目描述<textarea></textarea></label></div>${plainAdd('添加')}`;
    const heard: string[] = [];
    for (const el of Array.from(document.querySelectorAll('.sc-a, .sc-b, .sc-a span'))) {
      el.addEventListener('click', () => heard.push(el.tagName.toLowerCase() + (el.className ? `.${el.className}` : '')));
    }
    const found = findAddButtons(document);
    expect(found).toHaveLength(1);
    (found[0]!.el as HTMLElement).click();
    expect(heard.sort()).toEqual(['div.sc-a', 'div.sc-b', 'span']);
  });

  it('reads the words of the whole element when React writes them in two pieces', () => {
    document.body.innerHTML = `<h2>教育经历</h2><div><label>学校<input></label><label>专业<input></label></div>${plainAdd('添加<!-- -->项目经历')}`;
    expect(findAddButtons(document).map((b) => [b.text, b.section, b.named])).toEqual([['添加项目经历', 'projects', true]]);
  });

  it('leaves alone the same words where nothing shows them as clickable', () => {
    document.body.innerHTML = `<h2>项目经历</h2><div><label>项目名称<input></label><label>项目描述<textarea></textarea></label></div>${plainAdd('添加', false)}<p style="cursor:pointer">添加的内容请写在下面</p>`;
    expect(findAddButtons(document)).toEqual([]);
  });

  // Feishu's desktop form sets no pointer on the 添加 of a section that has no entry yet; only its class says what it
  // is (createFormSection-addBtn). Captured 21 Nov 2026.
  it('finds the add words of an empty section by a class that names them an add button', () => {
    document.body.innerHTML = FEISHU_DESKTOP_ENTRIES;
    expect(findAddButtons(document).map((b) => [b.text, b.section])).toContainEqual(['添加', 'internship']);
  });

  // Each empty section is its title and its 添加, one after another: a button takes its own section's title, never the
  // one of the empty section before it.
  it('gives the add button of each empty section its own section, and none to a section no resume has', () => {
    document.body.innerHTML = FEISHU_DESKTOP_ENTRIES;
    const empty = findAddButtons(document).filter((b) => b.el.closest('.createFormSection-container-empty'));
    expect(empty.map((b) => b.section)).toEqual(['internship', 'projects', null, 'awards']);
  });

  // Feishu's formily form on a phone (NIO): an empty section is a title row of its name and a 添加 button, the button
  // three wrappers down. The empty section before it must not take it.
  it('gives the 添加 in a formily phone title row its own section, not that of the empty section above', () => {
    const empty = (title: string, extra = '') =>
      `<div class="moduleWrapper moduleWrapper-empty"><div class="moduleWrapper-title"><p class="moduleWrapper-text">${title}</p>` +
      `<div class="formily-m-item"><div class="formily-m-item-control"><div class="formily-m-item-control-content">` +
      `<button type="button" class="ud__button">添加</button></div></div></div></div>${extra}</div>`;
    const filled = (title: string) =>
      `<div class="moduleWrapper"><div class="moduleWrapper-title"><p class="moduleWrapper-text">${title}</p></div>` +
      `<div class="formily-m-item" data-form-field-id="name"><input><input></div></div>`;
    document.body.innerHTML = `<form>${filled('项目经历')}${empty('实习经历')}${filled('作品')}${empty('获奖')}${filled('语言能力')}${empty('社交账号')}</form>`;
    expect(findAddButtons(document).map((b) => b.section)).toEqual(['internship', 'awards', null]);
  });

  // Feishu's mobile form: the section title holds its name and a "+ 添加" drawn as a span, and a filled section ends
  // in "删除 | 继续添加". Touch pages set no cursor at all, so the pointer cannot say what is clickable there.
  const touchPage = (coarse: boolean) => {
    window.matchMedia = ((query: string) => ({
      matches: coarse && /\(\s*pointer\s*:\s*coarse\s*\)/.test(query),
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    })) as typeof window.matchMedia;
  };
  const mobileSection = (title: string, cls: string, cards = '') =>
    `<div class="resumeEditForm-${cls}"><div class="createFormSection-title"><div class="createFormSection-name">${title}</div>` +
    `<div class="createFormSection-add__wrapper"><svg class="icon"></svg><span class="createFormSection-addText">添加</span></div></div>${cards}</div>`;
  // A card: rows of a label column and a control column, then 删除 | 继续添加.
  const mobileRow = (label: string) =>
    `<div class="atsx-row atsx-form-item"><div class="atsx-col atsx-form-item-label"><label>${label}</label></div>` +
    `<div class="atsx-col atsx-form-item-control"><input class="atsx-input"></div></div>`;
  const mobileCard = (...labels: string[]) =>
    `<div class="resumeEditForm-item">${labels.map(mobileRow).join('')}` +
    `<div class="formOperate"><div class="formOperate-delete"><svg></svg>删除</div><div class="formOperate-addMore"><svg></svg>继续添加</div></div></div>`;

  describe('on a touch page', () => {
    afterEach(() => {
      delete (window as { matchMedia?: unknown }).matchMedia;
    });

    it('finds the add words of a collapsed section although nothing sets a pointer', () => {
      touchPage(true);
      document.body.innerHTML = mobileSection('项目经历', 'project') + mobileSection('语言能力', 'language');
      expect(findAddButtons(document).map((b) => [b.text, b.section, b.named])).toEqual([
        ['添加', 'projects', false],
        ['添加', 'languages', false],
      ]);
    });

    it('finds 继续添加 under a card and never takes 删除 beside it', () => {
      touchPage(true);
      document.body.innerHTML = `<h2>教育经历</h2>${mobileCard('学校名称', '专业')}`;
      expect(findAddButtons(document).map((b) => [b.text, b.section])).toEqual([['继续添加', 'education']]);
    });

    it('ties 继续添加 to its section when most of the card is pickers with no input behind them', () => {
      touchPage(true);
      // As captured on the phone: the title holds only the words once a card exists, and only 专业 is a text box.
      const pickerRow = (title: string, control: string) =>
        `<div><div class="atsx-row atsx-form-item"><div class="atsx-form-item-control"><span class="atsx-form-item-children"><div class="atsx-col atsx-form-item-label"><label title="${title}">${title}</label></div></span></div><div class="atsx-col atsx-form-item-control-wrapper">${control}</div></div></div>`;
      document.body.innerHTML =
        `<div class="resumeEditForm-education createFormSection-mutiple"><div class="createFormSection-title"><p class="createFormSection-text">教育经历</p></div>` +
        `<div class="createFormSection-formList"><div class="resumeEditForm-item resumeEditForm-RepeatModule">` +
        pickerRow('学校名称', mschool('某某大学')) +
        pickerRow('学历', mselect('硕士')) +
        pickerRow('专业', '<input class="atsx-input" type="text">') +
        pickerRow('起止时间', mperiod('2020-09', '2024-07')) +
        `<div><div class="formOperate"><div class="formOperate-addMore formOperate-operate"><svg></svg>继续添加</div></div></div>` +
        `</div></div></div>`;
      expect(findAddButtons(document).map((b) => [b.text, b.section])).toEqual([['继续添加', 'education']]);
    });

    it('a picker row whose answer names another part of a resume is no heading', () => {
      touchPage(true);
      const pickerRow = (title: string, control: string) =>
        `<div><div class="atsx-row atsx-form-item"><div class="atsx-col atsx-form-item-label"><label>${title}</label></div><div class="atsx-col atsx-form-item-control-wrapper">${control}</div></div></div>`;
      document.body.innerHTML =
        `<div class="resumeEditForm-career"><div class="createFormSection-title"><p class="createFormSection-text">工作经历</p></div>` +
        `<div class="createFormSection-formList"><div class="resumeEditForm-item">` +
        pickerRow('公司名称', '<input class="atsx-input" type="text">') +
        pickerRow('职位', '<input class="atsx-input" type="text">') +
        pickerRow('经历类型', mselect('实习经历')) +
        `<div><div class="formOperate"><div class="formOperate-addMore"><svg></svg>继续添加</div></div></div>` +
        `</div></div></div>`;
      expect(findAddButtons(document).map((b) => [b.text, b.section])).toEqual([['继续添加', 'work']]);
    });

    it('still leaves alone a sentence about adding', () => {
      touchPage(true);
      document.body.innerHTML = `<h2>项目经历</h2><p>添加的内容请写在下面</p>`;
      expect(findAddButtons(document)).toEqual([]);
    });

    // The phone's fill browser runs on every site, so on a touch page the words alone are not enough: something has
    // to draw them as a button, an icon, a plus, or a name that says so.
    it('leaves alone bare add words that nothing draws as a button', () => {
      touchPage(true);
      document.body.innerHTML = `<h2>项目经历</h2><div class="tips"><div>添加</div></div><h3>新增</h3><div class="addressBook">增加</div>`;
      expect(findAddButtons(document)).toEqual([]);
    });

    it('takes add words drawn with a plus, an icon font, or a name that says add', () => {
      touchPage(true);
      document.body.innerHTML =
        `<h2>项目经历</h2><div><span>+ 添加</span></div>` +
        `<h2>语言能力</h2><div><i class="iconfont icon-plus"></i><span>添加</span></div>` +
        `<h2>获奖情况</h2><div class="award-addBtn">添加</div>`;
      expect(findAddButtons(document)).toHaveLength(3);
    });

    it('opens a collapsed section once per resume entry', async () => {
      touchPage(true);
      document.body.innerHTML = mobileSection('项目经历', 'project');
      // As on Feishu: the title's "+ 添加" opens the first card and goes away; each card's 继续添加 opens the next.
      const section = document.querySelector('.resumeEditForm-project')!;
      section.addEventListener('click', (e) => {
        const t = e.target as Element;
        if (t.closest('.createFormSection-add__wrapper')) section.querySelector('.createFormSection-add__wrapper')!.remove();
        else if (!t.closest('.formOperate-addMore')) return;
        section.insertAdjacentHTML('beforeend', mobileCard('项目名称', '项目角色'));
      });
      const need = zh.projects.length;
      expect(need).toBeGreaterThan(1);
      const onProgress = vi.fn();
      const [growth] = await ensureCards(document, zh, { timeoutMs: 200, onProgress });
      expect(growth).toMatchObject({ section: 'projects', need, have: need, status: 'ok' });
      // Each card it adds is a sign it is still at work: adding many can outlast a frame's budget.
      expect(onProgress).toHaveBeenCalledTimes(need);
    });

    it('opens a section whose card is only pickers, with no input behind any of them', async () => {
      touchPage(true);
      document.body.innerHTML = mobileSection('语言能力', 'language');
      const section = document.querySelector('.resumeEditForm-language')!;
      const pickerRow = (title: string) =>
        `<div class="atsx-row atsx-form-item"><div class="atsx-col atsx-form-item-label"><label>${title}</label></div><div class="atsx-col atsx-form-item-control-wrapper">${mselect('', ['英语', '日语'])}</div></div>`;
      section.addEventListener('click', (e) => {
        if (!(e.target as Element).closest('.createFormSection-add__wrapper')) return;
        section.querySelector('.createFormSection-add__wrapper')!.remove();
        section.insertAdjacentHTML('beforeend', `<div class="resumeEditForm-item">${pickerRow('语言')}${pickerRow('精通程度')}</div>`);
      });
      const [growth] = await ensureCards(document, zh, { timeoutMs: 200 });
      expect(growth).toMatchObject({ section: 'languages', need: zh.languages.length, added: 1, status: 'ok' });
    });
  });

  it('without a touch screen, plain add words still need the pointer', () => {
    touchPage(false);
    document.body.innerHTML = mobileSection('项目经历', 'project');
    expect(findAddButtons(document)).toEqual([]);
    delete (window as { matchMedia?: unknown }).matchMedia;
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

  it('a card that already holds someone’s own entry takes none of the resume’s, and one that holds the resume’s does', async () => {
    const twoCards = (school: string) => {
      mount();
      document.getElementById('edu')!.insertAdjacentHTML('beforeend', eduCard(2));
      (document.getElementById('s1') as HTMLInputElement).value = school;
    };
    twoCards('他人大学');
    await ensureCards(document, zh, { timeoutMs: 500 });
    expect(document.querySelectorAll('#edu .entry')).toHaveLength(3);
    document.body.innerHTML = '';
    twoCards(zh.education[1]!.school);
    await ensureCards(document, zh, { timeoutMs: 500 });
    expect(document.querySelectorAll('#edu .entry')).toHaveLength(2);
  });

  it('grows a Beisen section through its plain add button: one project on the page, two on the resume', async () => {
    const doc = new DOMParser().parseFromString(`<body>${BEISEN_FORM}</body>`, 'text/html');
    document.body.replaceChildren(...Array.from(doc.body.childNodes).map((n) => document.adoptNode(n)));
    // Only the projects section: scanning the whole form again after every click is slow in jsdom.
    for (const s of Array.from(document.querySelectorAll('.sc-sect'))) if (s.querySelector('.sc-title')!.textContent !== '项目经历') s.remove();
    const projects = document.querySelector('.sc-sect')!;
    const body = projects.querySelector('.sc-body')!;
    // Leave the section with one project, as a fresh form has it.
    body.querySelectorAll('.sc-entry')[1]!.remove();
    const entry = body.querySelector('.sc-entry')!.outerHTML;
    const add = body.querySelector('.sc-add')!;
    let clicks = 0;
    add.addEventListener('click', () => {
      clicks++;
      add.insertAdjacentHTML('beforebegin', entry);
    });
    const results = await ensureCards(document, zh, { timeoutMs: 500 });
    expect(body.querySelectorAll('.sc-entry')).toHaveLength(2);
    expect(clicks).toBe(1);
    expect(results.find((r) => r.section === 'projects')).toMatchObject({ added: 1, status: 'ok', have: 2, need: 2 });
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