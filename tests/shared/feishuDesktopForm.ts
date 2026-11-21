// The shape of Feishu's desktop application form in its atsx- generation (campus portals, captured 21 Nov 2026 on
// a /campus/resume/<job>/apply page), classes as the page has them, and a stand-in for what the page does when
// clicked. It is antd 3 under the atsx prefix: a list opens a dropdown at the end of <body>, found through the box's
// aria-controls, and a pick closes it. A place is the same box with a tree in its dropdown: typing filters the tree
// and opens the path to what matches, and any level can be picked by its name. A school is a combobox: typing asks
// the site, and its answer is a list whose pick is written into the box. A span of months opens a panel of years
// and months for its start, then by itself for its end.

const row = (title: string, control: string) =>
  `<div class="atsx-row atsx-form-item"><div class="atsx-col atsx-form-item-label"><label title="${title}">${title}</label></div><div class="atsx-col atsx-form-item-control-wrapper"><div class="atsx-form-item-control"><span class="atsx-form-item-children">${control}</span></div></div></div>`;

const search = (id: string) =>
  `<div class="atsx-select-search atsx-select-search--inline"><div class="atsx-select-search__field__wrap"><input id="${id}" autocomplete="off" class="atsx-select-search__field"><span class="atsx-select-search__field__mirror">&nbsp;</span></div></div>`;

const selected = (shown: string) =>
  shown ? `<div class="atsx-select-selection-selected-value"><span class="atsx-clamp-content clamp-content" data-cy-value="${shown}">${shown}</span></div>` : '';

/** A list, or a place tree when the stand-in is given a tree for `id`. `shown` is what an earlier answer left. */
export const aselect = (id: string, options: string[] = [], shown = '') =>
  `<div id="${id}" class="atsx-select-lg atsx-select-theme-default atsx-select atsx-select-enabled atsx-select-allow-clear" data-options="${options.join('|')}"><div class="atsx-select-selection atsx-select-selection--single" role="combobox" aria-autocomplete="list" aria-haspopup="true" aria-controls="dd-${id}" aria-expanded="false" data-cy="${id}Input" tabindex="0"><div class="atsx-select-selection__rendered">${selected(shown)}${search(id)}</div><span class="atsx-select-arrow"></span></div></div>`;

/** A school: a combobox whose words go to the site's search. */
export const aschool = (id: string, shown = '') =>
  `<div id="${id}" class="atsx-select-lg atsx-select-theme-default atsx-select atsx-select-combobox atsx-select-enabled atsx-select-no-arrow"><div class="atsx-select-selection atsx-select-selection--single" role="combobox" aria-autocomplete="list" aria-haspopup="true" aria-controls="dd-${id}" aria-expanded="false" data-cy="${id}Input"><div class="atsx-select-selection__rendered"><ul><li class="atsx-select-search atsx-select-search--inline"><div class="atsx-select-search__field__wrap"><input id="${id}" autocomplete="off" class="atsx-select-search__field" value="${shown}"><span class="atsx-select-search__field__mirror">${shown}&nbsp;</span></div></li></ul></div></div></div>`;

const end = (cy: string, value: string) => {
  const [y, m] = value ? value.split('-') : ['YYYY', 'MM'];
  return `<div class="atsx-date-picker-period-month-label" data-cy="${cy}"><span class="atsx-date-picker-period-month-label-year" data-cy="year">${y}</span><span class="atsx-date-picker-period-month-label-separator">-</span><span class="atsx-date-picker-period-month-label-month" data-cy="month">${m}</span></div>`;
};

/** A span of months: `from` and `to` as YYYY-MM. */
export const aperiod = (cy: string, from = '', to = '') =>
  `<div class="atsx-date-picker atsx-date-picker-period-month" data-cy="${cy}">${end(`${cy}Begin`, from)}<div class="atsx-date-picker-period-line"></div>${end(`${cy}End`, to)}<input class="atsx-date-picker-period-hidden-input"></div>`;

export interface Place {
  name: string;
  children?: Place[];
}

export const PLACES: Place[] = [
  {
    name: '中国大陆',
    children: [
      { name: '广东', children: [{ name: '广州', children: [{ name: '天河区' }] }, { name: '深圳', children: [{ name: '南山区' }, { name: '福田区' }] }] },
      { name: '浙江', children: [{ name: '杭州', children: [{ name: '西湖区' }, { name: '滨江区' }] }] },
      { name: '江西', children: [{ name: '南昌', children: [{ name: '西湖区' }] }] },
    ],
  },
  { name: '中国香港' },
];

export const GENDERS = ['男', '女', '其他'];
export const SCHOOLS = ['浙江大学', '浙江工业大学', '浙江工商大学', '浙江大学城市学院'];

export const FEISHU_DESKTOP_FORM =
  `<form class="atsx-form">` +
  row('姓名', `<input id="name" class="atsx-input atsx-input-lg" type="text" value="">`) +
  row('性别', aselect('gender', GENDERS)) +
  row('所在地点', aselect('currentCityCode')) +
  `<div class="resumeEditForm-education"><div class="resumeEditForm-item">` +
  row('学校名称', aschool('education[0].school')) +
  row('起止时间', aperiod('education[0].periodInput')) +
  `</div></div></form>`;

/** A field as the page writes it: its name, and under it a line of advice that is no part of the question. */
export const field = (id: string, name: string, control: string, desc = '') =>
  `<div class="atsx-col atsx-col-24"><div data-cy="${id}" class="atsx-row atsx-form-item customResumeForm-fieldName-with-desc-item"><div class="atsx-col atsx-form-item-label"><label for="${id}" class=""><div class="customResumeForm-fieldName">${name}</div><div class="customResumeForm-fieldName-desc">${desc}</div></label></div><div class="atsx-col atsx-form-item-control-wrapper"><div class="atsx-form-item-control"><span class="atsx-form-item-children">${control}</span></div></div></div></div>`;

const text = (id: string) => `<input autocomplete="off" type="text" id="${id}" class="atsx-input atsx-input-lg">`;

/** A section of entries, titled at its left: `cards` are each entry's fields; none leaves only its 添加. */
export const section = (cls: string, title: string, cards: string[]) =>
  `<div class="createFormSection-container${cards.length ? '' : ' createFormSection-container-empty'}"><div class="resumeEditForm-${cls} createFormSection-mutiple createFormSection-repeatable"><div class="createFormSection-left"><div class="createFormSection-title"><p class="createFormSection-text sofiaBold">${title}</p></div><p class="createFormSection-desc"></p></div><div class="createFormSection-right">${
    cards.length ? `<div class="createFormSection-formList createFormSection-formList-mutiple">${cards.map((c) => `<div class="resumeEditForm-item resumeEditForm-${cls}">${c}</div>`).join('')}</div>` : ''
  }<div class="createFormSection-addBtn addMore__d36c7e"><i class="anticon addMore-plus"></i><span class="addMore-add">添加</span></div></div></div></div>`;

/**
 * The entry sections as the 21 Nov capture has them: one school, one job, and sections with none yet, each only a
 * title and its 添加. 作品 (a portfolio) is a section no resume has.
 */
export const FEISHU_DESKTOP_ENTRIES =
  `<form class="atsx-form">` +
  section('education', '教育经历', [
    field('education[0].school', '学校名称', aschool('education[0].school')) +
      field('education[0].field_of_study', '专业', text('education[0].field_of_study')) +
      field('education[0].period', '起止时间', aperiod('education[0].periodInput'), '无准确的毕业时间可填写预计毕业时间'),
  ]) +
  section('career', '工作经历', [
    field('career[0].company', '公司名称', text('career[0].company')) +
      field('career[0].title', '职位名称', text('career[0].title')) +
      field('career[0].period', '起止时间', aperiod('career[0].periodInput')) +
      field('career[0].desc', '描述', `<textarea id="career[0].desc" class="atsx-input"></textarea>`),
  ]) +
  section('internship', '实习经历', []) +
  section('project', '项目经历', []) +
  section('work', '作品', []) +
  section('award', '获奖', []) +
  `</form>`;

export interface DesktopPage {
  stop(): void;
  /** Requests the school box sent, in order. */
  searches: string[];
}

const HIDDEN = 'atsx-select-dropdown-hidden';
const clean = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim();

/**
 * What the page does. `trees` gives a list box its places by id; `schools` is what the site's search knows, and the
 * search answers after `searchMs`.
 */
export function behave(
  doc: Document,
  opts: { trees?: Record<string, Place[]>; schools?: string[]; searchMs?: number; now?: number } = {},
): DesktopPage {
  const page: DesktopPage = { stop, searches: [] };
  const now = opts.now ?? 2026;
  const timers: ReturnType<typeof setTimeout>[] = [];

  const cyOf = (root: HTMLElement) => `${root.querySelector('[data-cy]')!.getAttribute('data-cy')}Dropdown`;
  const dropdownOf = (root: HTMLElement): HTMLElement | null =>
    doc.querySelector(`[data-cy="${CSS.escape(cyOf(root))}"]`)?.closest<HTMLElement>('.atsx-select-dropdown') ?? null;

  function shutAll() {
    doc.querySelectorAll<HTMLElement>('.atsx-select-dropdown').forEach((d) => d.classList.add(HIDDEN));
    doc.querySelectorAll('[aria-expanded="true"]').forEach((s) => s.setAttribute('aria-expanded', 'false'));
    doc.querySelectorAll('.atsx-date-picker-dropdown').forEach((d) => d.parentElement!.remove());
  }

  /** A tree's content has no id: only its data-cy ties it to the box. */
  function dropdown(root: HTMLElement, inner: string, tree = false): HTMLElement {
    let dd = dropdownOf(root);
    const id = root.querySelector('[aria-controls]')!.getAttribute('aria-controls')!;
    if (!dd) {
      const host = doc.createElement('div');
      host.innerHTML = `<div style="position: absolute"><div><div class="atsx-select-dropdown atsx-select-dropdown--single"><div ${tree ? '' : `id="${id}" `}data-cy="${cyOf(root)}"></div></div></div></div>`;
      doc.body.appendChild(host);
      dd = host.querySelector<HTMLElement>('.atsx-select-dropdown')!;
    }
    dd.querySelector(`[data-cy="${CSS.escape(cyOf(root))}"]`)!.innerHTML = inner;
    dd.classList.remove(HIDDEN);
    root.querySelector('[aria-controls]')!.setAttribute('aria-expanded', 'true');
    return dd;
  }

  const items = (labels: string[]) =>
    `<ul role="listbox" class="atsx-select-dropdown-menu atsx-select-dropdown-menu-root">${labels
      .map((l) => `<li role="option" class="atsx-select-dropdown-menu-item"><span class="atsx-clamp-content clamp-content" data-cy-value="${l}">${l}</span></li>`)
      .join('')}</ul>`;

  function choose(root: HTMLElement, label: string) {
    root.querySelector('.atsx-select-selection-selected-value')?.remove();
    root.querySelector('.atsx-select-selection__rendered')!.insertAdjacentHTML('afterbegin', selected(label));
    const input = root.querySelector<HTMLInputElement>('input')!;
    input.value = '';
    shutAll();
  }

  // ---- a tree of places ----
  const shows = (p: Place, words: string): boolean => !words || p.name.includes(words) || (p.children ?? []).some((c) => shows(c, words));
  function treeHtml(places: Place[], words: string, open: Set<string>, under = false, path = ''): string {
    return `<ul class="atsx-tree" role="${path ? 'group' : 'tree'}">${places
      .filter((p) => under || shows(p, words))
      .map((p) => {
        const key = `${path}/${p.name}`;
        const kids = p.children ?? [];
        const expanded = kids.length > 0 && ((words && (shows(p, words) || under)) || open.has(key));
        const below = under || (!!words && p.name.includes(words));
        return `<li role="treeitem" class="atsx-tree-treenode-switcher-${expanded ? 'open' : 'close'}" data-key="${key}">${
          kids.length ? `<span class="atsx-tree-switcher atsx-tree-switcher_${expanded ? 'open' : 'close'}"></span>` : ''
        }<span class="atsx-tree-node-content-wrapper"><span class="atsx-tree-title"><span class="atsx-clamp-content clamp-content" data-cy-value="${p.name}">${p.name}</span></span></span>${
          expanded ? treeHtml(kids, words, open, below, key) : ''
        }</li>`;
      })
      .join('')}</ul>`;
  }
  function drawTree(root: HTMLElement, places: Place[], words: string, open = new Set<string>()) {
    const dd = dropdown(root, `<div class="atsx-select-tree-wrapper">${treeHtml(places, words, open)}</div>`, true);
    dd.querySelectorAll<HTMLElement>('.atsx-tree-switcher').forEach((s) =>
      s.addEventListener('click', () => {
        const key = s.closest('li')!.getAttribute('data-key')!;
        open.has(key) ? open.delete(key) : open.add(key);
        drawTree(root, places, words, open);
      }),
    );
    dd.querySelectorAll<HTMLElement>('.atsx-tree-node-content-wrapper').forEach((w) =>
      w.addEventListener('click', () => choose(root, clean(w.textContent))),
    );
  }

  // ---- a school: the site's search ----
  function askSchool(root: HTMLElement, words: string) {
    page.searches.push(words);
    timers.push(
      setTimeout(() => {
        const known = opts.schools ?? [];
        const hits = known.filter((s) => s.includes(words)).sort((a, b) => Number(b === words) - Number(a === words));
        const dd = dropdown(root, items(hits));
        dd.querySelectorAll<HTMLElement>('.atsx-select-dropdown-menu-item').forEach((li) =>
          li.addEventListener('click', () => {
            const input = root.querySelector<HTMLInputElement>('input')!;
            input.value = clean(li.textContent);
            shutAll();
          }),
        );
      }, opts.searchMs ?? 20),
    );
  }

  // ---- a span of months ----
  function openPeriod(label: HTMLElement) {
    shutAll();
    const cy = label.getAttribute('data-cy')!;
    const isEnd = cy.endsWith('End');
    const years = Array.from({ length: (isEnd ? now + 10 : now) - 1899 }, (_, i) => String((isEnd ? now + 10 : now) - i));
    const months = Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(2, '0'));
    const list = (xs: string[]) =>
      `<div class="scrollbar-container atsx-date-picker-period-month-panel-list">${xs.map((x) => `<div class="atsx-date-picker-period-month-panel-list-item" data-cy="${x}">${x}</div>`).join('')}</div>`;
    const host = doc.createElement('div');
    host.innerHTML = `<div class="atsx-date-picker-dropdown"><div class="atsx-date-picker-period-month-panel" data-cy="${cy}Dropdown">${list(years)}<div class="atsx-date-picker-period-month-panel-separator-line"></div>${list(months)}</div></div>`;
    doc.body.appendChild(host);
    const [yearList, monthList] = Array.from(host.querySelectorAll('.atsx-date-picker-period-month-panel-list'));
    yearList!.querySelectorAll<HTMLElement>('.atsx-date-picker-period-month-panel-list-item').forEach((y) =>
      y.addEventListener('click', () => {
        label.querySelector('[data-cy="year"]')!.textContent = clean(y.textContent);
      }),
    );
    monthList!.querySelectorAll<HTMLElement>('.atsx-date-picker-period-month-panel-list-item').forEach((m) =>
      m.addEventListener('click', () => {
        // A month before its year counts for nothing.
        if (label.querySelector('[data-cy="year"]')!.textContent === 'YYYY') return;
        label.querySelector('[data-cy="month"]')!.textContent = clean(m.textContent);
        host.remove();
        if (!isEnd) openPeriod(label.parentElement!.querySelector<HTMLElement>(`[data-cy="${cy.replace(/Begin$/, 'End')}"]`)!);
      }),
    );
  }

  function onClick(e: Event) {
    const target = e.target as HTMLElement;
    const label = target.closest<HTMLElement>('.atsx-date-picker-period-month-label');
    if (label) return openPeriod(label);
    const selection = target.closest('.atsx-select-selection');
    const root = selection?.closest<HTMLElement>('.atsx-select');
    if (root && !root.classList.contains('atsx-select-combobox')) {
      const tree = opts.trees?.[root.id];
      if (tree) return drawTree(root, tree, '');
      const dd = dropdown(root, items((root.getAttribute('data-options') ?? '').split('|').filter(Boolean)));
      dd.querySelectorAll<HTMLElement>('.atsx-select-dropdown-menu-item').forEach((li) => li.addEventListener('click', () => choose(root, clean(li.textContent))));
      return;
    }
    // A click anywhere else closes what is open, as antd does.
    if (!target.closest('.atsx-select-dropdown, .atsx-date-picker-dropdown')) shutAll();
  }

  function onInput(e: Event) {
    const input = e.target as HTMLInputElement;
    const root = input.closest<HTMLElement>('.atsx-select');
    if (!root) return;
    input.nextElementSibling!.textContent = `${input.value} `;
    if (root.classList.contains('atsx-select-combobox')) return askSchool(root, input.value);
    const tree = opts.trees?.[root.id];
    if (tree) drawTree(root, tree, input.value);
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Escape') shutAll();
  }

  doc.addEventListener('click', onClick, true);
  doc.addEventListener('input', onInput, true);
  doc.addEventListener('keydown', onKey, true);
  function stop() {
    timers.forEach(clearTimeout);
    doc.removeEventListener('click', onClick, true);
    doc.removeEventListener('input', onInput, true);
    doc.removeEventListener('keydown', onKey, true);
  }
  return page;
}
