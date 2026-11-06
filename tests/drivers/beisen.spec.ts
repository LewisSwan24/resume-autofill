// Beisen's (北森) Phoenix widgets, driven on a stand-in that behaves the way the real ones were seen to on a live
// form: every panel in a layer at the end of <body>, lists drawn a few rows at a time with a search above them,
// dates typed into a day calendar or picked a month at a time, places walked down and then confirmed, and radio
// answers with no input behind them. The real page is still the real proof.
import { expect, test, type Page } from '@playwright/test';
import { BEISEN_FORM } from '../shared/beisenForm';
import { execIntent, injectHarness } from './helpers';

let page: Page;

test.beforeEach(async ({ page: p }) => {
  page = p;
  await page.goto('/aria/');
  await page.getByLabel('First Name', { exact: true }).waitFor();
  await injectHarness(page);
});

const choice = (query: string, ...wider: string[]) => ({ kind: 'choice', display: query, query, ...(wider.length ? { wider } : {}) }) as const;
const date = (year: number, month: number, day?: number) =>
  ({ kind: 'date', display: `${year}-${month}`, year, month, ...(day ? { day } : {}) }) as const;

const TREE: Record<string, Record<string, string[]>> = {
  北京市: { 北京市: ['东城区'] },
  浙江省: { 杭州市: ['上城区', '西湖区', '滨江区'], 宁波市: ['海曙区'] },
  四川省: { 成都市: ['锦江区', '武侯区'] },
};

interface Setup {
  lists?: Record<string, string[]>;
  days?: string[];
  months?: string[];
  places?: string[];
  /** Pickers of constants: a flat list, or groups that are stepped into; `limit` above one takes several. */
  constants?: Record<string, { entries: string[] | Record<string, string[]>; limit?: number }>;
}

async function mountBeisen(setup: Setup): Promise<void> {
  await page.evaluate(
    ([html, s, tree]) => {
      const setup = s as Setup;
      const places = tree as Record<string, Record<string, string[]>>;
      document.body.innerHTML = html as string;
      const closeLayers = () => document.querySelectorAll('[data-layer]').forEach((l) => l.remove());
      document.addEventListener('mousedown', (e) => {
        if (!(e.target as Element).closest('[data-layer]')) closeLayers();
      });
      const titleOf = (el: Element) => el.closest('.form-item')!.querySelector('.form-item__text')!.textContent!.trim();
      const put = (box: HTMLInputElement, value: string) => {
        box.value = value;
        box.closest('.phoenix-select')!.querySelector('.phoenix-select__placeHolder')!.textContent = value || '请选择';
      };
      const layerFor = (box: Element, inner: string) => {
        closeLayers();
        const r = box.getBoundingClientRect();
        const wrap = document.createElement('div');
        wrap.setAttribute('data-layer', '');
        wrap.innerHTML = `<div class="common-unmodeled-layer" style="position:absolute;left:${r.left}px;top:${r.bottom + window.scrollY}px;width:320px;background:#fff"><div class="common-unmodeled-layer__layerContent">${inner}</div></div>`;
        document.body.append(wrap);
        return wrap.querySelector<HTMLElement>('.common-unmodeled-layer__layerContent')!;
      };
      (window as unknown as { opened: number }).opened = 0;

      function openList(box: HTMLInputElement, items: string[]) {
        const layer = layerFor(
          box,
          '<div class="phoenix-selectList phoenix-selectList--search"><div class="phoenix-selectList__searchWrapper"><div class="phoenix-input"><input class="phoenix-input__input phoenix-input__input--hasPrefix" placeholder="搜索"></div></div><div class="phoenix-selectList__contentWraper"><ul class="phoenix-selectList__list"></ul></div></div>',
        );
        const list = layer.querySelector('ul')!;
        const search = layer.querySelector('input')!;
        // Only the rows in view are drawn.
        const draw = () => {
          list.innerHTML = items
            .filter((i) => i.includes(search.value))
            .slice(0, 5)
            .map((i) => `<li class="phoenix-selectList__listItem"><div class="phoenix-selectList__singleLabel"><span><span>${i}</span></span></div></li>`)
            .join('');
        };
        search.addEventListener('input', () => setTimeout(draw, 100));
        draw();
        layer.addEventListener('click', (e) => {
          const li = (e.target as Element).closest('li');
          if (!li) return;
          put(box, li.textContent!.trim());
          closeLayers();
        });
      }

      function openDay(box: HTMLInputElement) {
        const layer = layerFor(box, '<div class="phoenix-date-picker"><div class="phoenix-calendar"><div class="phoenix-calendar-input-wrap"><input class="phoenix-calendar-input" placeholder="请输入"></div><div class="phoenix-calendar-body"></div></div></div>');
        const input = layer.querySelector('input')!;
        input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || !/^\d{4}-\d{2}-\d{2}$/.test(input.value)) return;
          put(box, input.value);
          closeLayers();
        });
      }

      function openMonth(box: HTMLInputElement) {
        let year = 2026;
        const layer = layerFor(
          box,
          `<div class="phoenix-date-picker"><div class="phoenix-calendar phoenix-calendar-month-calendar"><div class="phoenix-calendar-month-panel"><div class="phoenix-calendar-month-panel-header"><a class="phoenix-calendar-month-panel-prev-year-btn"></a><a class="phoenix-calendar-month-panel-year-select"><span class="phoenix-calendar-month-panel-year-select-content">${year}</span></a><a class="phoenix-calendar-month-panel-next-year-btn"></a></div><table><tbody>${Array.from({ length: 12 }, (_, i) => `<td class="phoenix-calendar-month-panel-cell"><a class="phoenix-calendar-month-panel-month">${i + 1}月</a></td>`).join('')}</tbody></table></div></div></div>`,
        );
        const shown = layer.querySelector('.phoenix-calendar-month-panel-year-select-content')!;
        layer.addEventListener('click', (e) => {
          const t = e.target as Element;
          if (t.closest('.phoenix-calendar-month-panel-prev-year-btn')) shown.textContent = String(--year);
          else if (t.closest('.phoenix-calendar-month-panel-next-year-btn')) shown.textContent = String(++year);
          const cell = t.closest('.phoenix-calendar-month-panel-cell');
          if (!cell) return;
          put(box, `${year}-${String(parseInt(cell.textContent!, 10)).padStart(2, '0')}`);
          closeLayers();
        });
      }

      function openPlace(box: HTMLInputElement) {
        const layer = layerFor(
          box,
          '<div class="area-selector-container"><div class="area-search-input"><div class="phoenix-input"><input class="phoenix-input__input" placeholder="搜索"></div></div><div class="content-container"><div class="left-container"><div class="area-data-container"></div></div><div class="right-container"><div class="select-data-container"><div class="select-data-empty">请在左侧选择地区</div></div></div></div><div class="area-footer-button"><div class="phoenix-button"><div class="phoenix-button__wraper"><div class="phoenix-button__content">取消</div></div></div><div class="phoenix-button"><div class="phoenix-button__wraper"><div class="phoenix-button__content">确定</div></div></div></div></div>',
        );
        const data = layer.querySelector('.area-data-container')!;
        const right = layer.querySelector('.select-data-container')!;
        let picked = '';
        const show = (names: string[], leaf: boolean) => {
          // The list comes in a moment after each step, as the real one loads it.
          data.innerHTML = '';
          setTimeout(() => {
            data.innerHTML = names
              .map(
                (n) =>
                  `<div class="area-item-container" data-leaf="${leaf}"><div class="area-item-name"><span class="icon-container visible"><svg class="area-icon-RadioUnchecked"><path></path></svg></span><span class="area-text-label${leaf ? ' no-hover' : ''}">${n}</span>${leaf ? '' : '<svg class="arrow"></svg>'}</div></div>`,
              )
              .join('');
          }, 150);
        };
        show(Object.keys(places), false);
        let province: string | null = null;
        layer.addEventListener('click', (e) => {
          const t = e.target as Element;
          const button = t.closest('.phoenix-button__content');
          if (button) {
            if (button.textContent === '确定' && picked) put(box, picked);
            closeLayers();
            return;
          }
          const item = t.closest('.area-item-container');
          if (!item) return;
          const name = item.querySelector('.area-text-label')!.textContent!;
          if (t.closest('svg') && t.closest('.icon-container')) {
            picked = name;
            right.textContent = name;
            return;
          }
          if (item.getAttribute('data-leaf') === 'true') return;
          if (province === null) {
            province = name;
            show(Object.keys(places[name]!), false);
          } else show(places[province]![name]!, true);
        });
      }

      function openConstant(box: HTMLInputElement, def: { entries: string[] | Record<string, string[]>; limit?: number }) {
        const limit = def.limit ?? 1;
        const select = box.closest('.phoenix-select')!;
        const layer = layerFor(
          select,
          `<div class="constant-main-selector-container"><div class="constant-main-layer-container"><div class="content-search"><div class="phoenix-input search"><input class="phoenix-input__input" placeholder="搜索"></div></div><div class="content-container"><div class="left-container"><div class="list-data-container"></div></div><div class="right-container"><span class="select-data-num">0/${limit}</span><div class="select-data-container"><div class="select-data-empty">请在左侧选择内容</div></div></div></div></div><div class="selector-footer-button"><div class="phoenix-button"><div class="phoenix-button__wraper"><div class="phoenix-button__content">取消</div></div></div><div class="phoenix-button"><div class="phoenix-button__wraper"><div class="phoenix-button__content">确定</div></div></div></div></div>`,
        );
        const data = layer.querySelector('.list-data-container')!;
        const right = layer.querySelector('.select-data-container')!;
        const search = layer.querySelector('input')!;
        const picked: string[] = [];
        const groups = Array.isArray(def.entries) ? null : def.entries;
        const row = (name: string, leaf: boolean, path = '') =>
          `<div class="list-item-container list-item-container-two" data-leaf="${leaf}"><span class="icon-container"><svg class="RadioUnchecked"><path></path></svg></span><span class="item-text-label${leaf ? ' no-hover' : ''}"><span>${name}</span></span>${path ? `<div class="item-text-fullname">${path}</div>` : ''}</div>`;
        // Each step draws the list again, a moment later.
        const show = (html: string) => {
          data.innerHTML = '';
          setTimeout(() => (data.innerHTML = html), 120);
        };
        const top = () => show(groups ? Object.keys(groups).map((g) => row(g, false)).join('') : (def.entries as string[]).map((n) => row(n, true)).join(''));
        top();
        search.addEventListener('input', () => {
          if (!search.value) return top();
          const all = groups ? Object.entries(groups).flatMap(([g, ns]) => ns.map((n) => [n, g])) : (def.entries as string[]).map((n) => [n, '']);
          show(all.filter(([n]) => n!.includes(search.value)).map(([n, g]) => row(n!, true, g)).join(''));
        });
        layer.addEventListener('click', (e) => {
          const t = e.target as Element;
          const button = t.closest('.phoenix-button__content');
          if (button) {
            if (button.textContent === '确定' && picked.length > 0) {
              if (limit > 1) {
                select.querySelector('.phoenix-select__content')!.innerHTML = picked.map((p) => `<li class="phoenix-select__tagItem"><span class="phoenix-select__tag">${p}</span><span class="phoenix-select__tagIcon"></span></li>`).join('');
              } else put(box, picked[0]!);
            }
            closeLayers();
            return;
          }
          const entry = t.closest('.list-item-container');
          if (!entry) return;
          const name = entry.querySelector('.item-text-label')!.textContent!;
          if (t.closest('svg') && t.closest('.icon-container')) {
            if (limit === 1) picked.splice(0, picked.length, name);
            else if (!picked.includes(name) && picked.length < limit) picked.push(name);
            right.textContent = picked.join(' ');
            // Picking draws the list again.
            data.innerHTML = data.innerHTML;
            return;
          }
          if (entry.getAttribute('data-leaf') === 'false' && groups) show(groups[name]!.map((n) => row(n, true)).join(''));
        });
      }

      document.body.addEventListener('click', (e) => {
        const t = e.target as Element;
        const radio = t.closest('.phoenix-radio');
        if (radio) {
          radio.closest('.phoenix-radio-group')!.querySelectorAll('.phoenix-radio').forEach((r) => r.classList.remove('phoenix-radio--checked'));
          radio.classList.add('phoenix-radio--checked');
          return;
        }
        const select = t.closest('.phoenix-select');
        if (!select || t.closest('[data-layer]')) return;
        const box = select.querySelector<HTMLInputElement>('.phoenix-select__input')!;
        (window as unknown as { opened: number }).opened++;
        const title = titleOf(select);
        if (setup.constants?.[title]) openConstant(box, setup.constants[title]!);
        else if (setup.days?.includes(title)) openDay(box);
        else if (setup.months?.includes(title)) openMonth(box);
        else if (setup.places?.includes(title)) openPlace(box);
        else if (setup.lists?.[title]) openList(box, setup.lists[title]!);
      });
    },
    [BEISEN_FORM, setup, TREE] as const,
  );
}

const item = (title: string, nth = 0) =>
  page.locator('.form-item', { has: page.locator('.form-item__text', { hasText: new RegExp(`^${title}$`) }) }).nth(nth);
const box = (title: string, nth = 0) => item(title, nth).locator('.phoenix-select__input');
const layers = () => page.locator('[data-layer]');

test.describe('Beisen lists', () => {
  test('picks what fits among the rows in view', async () => {
    await mountBeisen({ lists: { 政治面貌: ['群众', '中共党员', '共青团员'] } });
    const r = await execIntent(page, '政治面貌', choice('共青团员'));
    expect(r.outcome).toBe('filled');
    await expect(box('政治面貌')).toHaveValue('共青团员');
    await expect(layers()).toHaveCount(0);
  });

  test('searches for an answer further down than the rows drawn', async () => {
    await mountBeisen({ lists: { 学历: ['大专', '本科', '硕士研究生', '博士研究生', '高中', '中专', 'MBA'] } });
    const r = await execIntent(page, '学历', choice('MBA'));
    expect(r.outcome).toBe('filled');
    await expect(box('学历')).toHaveValue('MBA');
  });

  test('nothing fitting picks nothing and shuts the list', async () => {
    await mountBeisen({ lists: { 政治面貌: ['群众', '中共党员'] } });
    const r = await execIntent(page, '政治面貌', choice('共青团员'));
    expect(r.outcome).toBe('no_option');
    await expect(box('政治面貌')).toHaveValue('');
    await expect(layers()).toHaveCount(0);
  });
});

test.describe('Beisen dates', () => {
  test('a day is written into its calendar', async () => {
    await mountBeisen({ days: ['出生日期'] });
    const r = await execIntent(page, '出生日期', date(2002, 3, 15));
    expect(r.outcome).toBe('filled');
    await expect(box('出生日期')).toHaveValue('2002-03-15');
    await expect(layers()).toHaveCount(0);
  });

  test('a month is picked after stepping back to its year', async () => {
    await mountBeisen({ months: ['开始时间'] });
    const r = await execIntent(page, '开始时间', date(2020, 9, 1), { nth: 0 });
    expect(r.outcome).toBe('filled');
    await expect(box('开始时间')).toHaveValue('2020-09');
    await expect(layers()).toHaveCount(0);
  });
});

test.describe('Beisen places', () => {
  test('walked down to the district and confirmed', async () => {
    await mountBeisen({ places: ['户口所在地'] });
    const r = await execIntent(page, '户口所在地', choice('西湖区', '杭州市', '浙江省'));
    expect(r.outcome).toBe('filled');
    await expect(box('户口所在地')).toHaveValue('西湖区');
    await expect(layers()).toHaveCount(0);
  });

  test('a district not on the list stops at the city and leaves that to check', async () => {
    await mountBeisen({ places: ['户口所在地'] });
    const r = await execIntent(page, '户口所在地', choice('高新区', '杭州市', '浙江省'));
    expect(r.outcome).toBe('needs_review');
    await expect(box('户口所在地')).toHaveValue('杭州市');
    await expect(layers()).toHaveCount(0);
  });

  test('a place abroad picks nothing and cancels', async () => {
    await mountBeisen({ places: ['现居住地'] });
    const r = await execIntent(page, '现居住地', choice('堪培拉', '澳大利亚首都领地'));
    expect(r.outcome).toBe('no_option');
    await expect(box('现居住地')).toHaveValue('');
    await expect(layers()).toHaveCount(0);
  });
});

const tags = (title: string) => item(title).locator('.phoenix-select__tag');

test.describe('Beisen pickers of constants', () => {
  test('several answers from a flat list, each picked by its circle, then confirmed', async () => {
    await mountBeisen({ constants: { 期望从事行业: { entries: ['银行', '广告', '互联网/电子商务', '教育/培训/院校'], limit: 40 } } });
    const r = await execIntent(page, '期望从事行业', { kind: 'multi', display: '', items: [{ query: '互联网/电子商务' }, { query: '银行' }] });
    expect(r.outcome).toBe('filled');
    await expect(tags('期望从事行业')).toHaveText(['互联网/电子商务', '银行']);
    await expect(layers()).toHaveCount(0);
  });

  test('an answer one level down is found by the search across levels', async () => {
    await mountBeisen({ constants: { 期望从事职业: { entries: { 项目管理类: ['项目经理', '项目主管'], 计算机类: ['后端开发工程师', '前端开发工程师'] } } } });
    const r = await execIntent(page, '期望从事职业', choice('后端开发工程师'));
    expect(r.outcome).toBe('filled');
    await expect(box('期望从事职业')).toHaveValue('后端开发工程师');
    await expect(layers()).toHaveCount(0);
  });

  test('only some of several answers on the list are picked and left to check', async () => {
    await mountBeisen({ constants: { 期望从事行业: { entries: ['银行', '广告'], limit: 40 } } });
    const r = await execIntent(page, '期望从事行业', { kind: 'multi', display: '', items: [{ query: '银行' }, { query: '航天' }] });
    expect(r.outcome).toBe('needs_review');
    await expect(tags('期望从事行业')).toHaveText(['银行']);
  });

  test('nothing on the list cancels and leaves the box empty', async () => {
    await mountBeisen({ constants: { 期望从事职业: { entries: { 项目管理类: ['项目经理'] } } } });
    const r = await execIntent(page, '期望从事职业', choice('宇航员'));
    expect(r.outcome).toBe('no_option');
    await expect(box('期望从事职业')).toHaveValue('');
    await expect(layers()).toHaveCount(0);
  });
});

test.describe('Beisen radios', () => {
  test('an answer with no input behind it is clicked and stays', async () => {
    await mountBeisen({});
    const r = await execIntent(page, '婚否', choice('未婚'));
    expect(r.outcome).toBe('filled');
    await expect(item('婚否').locator('.phoenix-radio--checked')).toHaveText('未婚');
  });

  test('an answer that is not offered is left alone', async () => {
    await mountBeisen({});
    const r = await execIntent(page, '性别', choice('其他'));
    expect(r.outcome).toBe('no_option');
    await expect(item('性别').locator('.phoenix-radio--checked')).toHaveCount(0);
  });
});
