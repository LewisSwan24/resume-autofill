// Moka's and Feishu's own widgets, driven on a stand-in that behaves the way the real ones were seen to: panels at
// the end of <body>, the box staying empty until something is picked. The real pages are still the real proof.
import { expect, test, type Page } from '@playwright/test';
import { FEISHU_ENTRY_FORM, FEISHU_FORM } from '../shared/feishuForm';
import { MOKA_ENTRY_FORM, MOKA_FORM } from '../shared/mokaForm';
import { fillEntries as fillCnEntries } from './cnEntries';
import { execIntent, injectHarness } from './helpers';

let page: Page;

test.beforeEach(async ({ page: p }) => {
  page = p;
  await page.goto('/aria/');
  await page.getByLabel('First Name', { exact: true }).waitFor();
  await injectHarness(page);
});

const choice = (query: string) => ({ kind: 'choice', display: query, query }) as const;
const month = (year: number, m: number) => ({ display: `${year}-${String(m).padStart(2, '0')}`, year, month: m });
const YEARS = Array.from({ length: 40 }, (_, i) => String(2030 - i));
const MONTHS = Array.from({ length: 12 }, (_, i) => String(i + 1));

/**
 * Lists keyed by the question's title, or by 年 and 月 for the date parts; what opens them and what picking does.
 * 添加 beside a section's title puts an empty entry under the last one, and 删除本条 takes its entry away.
 */
async function mountMoka(lists: Record<string, string[]>, form = MOKA_FORM): Promise<void> {
  await page.evaluate(
    ([html, options]) => {
      const box = document.createElement('div');
      box.innerHTML = html as string;
      document.body.replaceChildren(box);
      const ENTRY = '[class*="apply-fields-"][class*="multi-"]';
      const blank = new Map<Element, string>();
      for (const block of box.querySelectorAll('[class*="apply-block-"]')) {
        const first = block.querySelector(ENTRY);
        if (first) blank.set(block, first.outerHTML);
      }
      box.addEventListener('click', (e) => {
        const button = (e.target as Element).closest('button');
        if (!button) return;
        const block = button.closest('[class*="apply-block-"]')!;
        if (button.textContent!.trim() === '删除本条') button.closest(ENTRY)?.remove();
        else if (button.textContent!.trim() === '添加' && blank.has(block)) block.insertAdjacentHTML('beforeend', blank.get(block)!);
      });
      const all = options as Record<string, string[]>;
      const closePanels = () => document.querySelectorAll('.sd-Dropdown-dropdown-GmACl').forEach((p) => p.remove());
      document.addEventListener('mousedown', (e) => {
        if (!(e.target as Element).closest('.sd-Dropdown-dropdown-GmACl')) closePanels();
      });
      box.addEventListener('click', (e) => {
        const day = (e.target as Element).closest<HTMLElement>('label.day_info');
        if (day) {
          closePanels();
          const shown = (window as unknown as { panelYear?: number }).panelYear ?? 2000;
          const months = ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'];
          const panel = document.createElement('div');
          panel.className = 'sd-Dropdown-dropdown-GmACl';
          panel.innerHTML = `<div class="sd-basic-selector-year-1a">${shown}</div>${months.map((m) => `<div class="sd-basic-year-item-2b">${m}</div>`).join('')}`;
          panel.addEventListener('click', (ev) => {
            const cell = (ev.target as Element).closest('[class*="sd-basic-year-item"]');
            if (!cell || (window as unknown as { ignoreMonth?: boolean }).ignoreMonth) return;
            day.querySelector('input')!.value = `${shown}-${String(months.indexOf(cell.textContent!) + 1).padStart(2, '0')}`;
            closePanels();
          });
          document.body.append(panel);
          return;
        }
        const label = (e.target as Element).closest<HTMLElement>('label[class*="sd-Select-container"]');
        if (!label) return;
        closePanels();
        const title = label.closest('[class^="apply-field-"]')!.querySelector('[class^="title-"] span span')!.textContent!.trim();
        const place = label.querySelector('input')!.getAttribute('placeholder')!;
        const items = all[place === '年' || place === '月' ? place : title] ?? [];
        if (items.length === 0) return;
        const panel = document.createElement('div');
        panel.className = 'sd-Dropdown-dropdown-GmACl';
        panel.innerHTML = `<div class="sd-Select-menu-36GwS"><div class="sd-Select-scrollable-6CVW5">${items
          .map((o) => `<div class="sd-Menu-container-1WISQ"><span></span><div class="sd-Menu-content-bDquM"><div class="sd-Menu-content-item-3BOO1"><span>${o}</span></div></div></div>`)
          .join('')}</div></div>`;
        const tags = label.querySelector('[class*="sd-Input-tag-container"]');
        panel.addEventListener('click', (ev) => {
          const row = (ev.target as Element).closest('.sd-Menu-container-1WISQ');
          if (!row) return;
          const name = row.textContent!.trim();
          if (!tags) {
            label.querySelector('[class*="sd-Input-display-value"]')!.textContent = name;
            closePanels();
            return;
          }
          // Several answers: a pick toggles its tag and the row's tick, and the list stays open.
          const had = Array.from(tags.querySelectorAll('.sd-Tag-container-lJ8Xd')).find((t) => t.textContent === name);
          if (had) had.remove();
          else tags.querySelector('input')!.insertAdjacentHTML('beforebegin', `<span class="sd-Tag-container-lJ8Xd"><div class="sd-Tag-text-2nFJX">${name}</div></span>`);
          row.classList.toggle('sd-Menu-active-1TqKc', !had);
          row.querySelector('.sd-Menu-content-item-3BOO1 span')!.classList.toggle('active-_qJzoiImJc', !had);
        });
        if (tags) {
          for (const row of panel.querySelectorAll('.sd-Menu-container-1WISQ')) {
            const on = Array.from(tags.querySelectorAll('.sd-Tag-container-lJ8Xd')).some((t) => t.textContent === row.textContent!.trim());
            row.classList.toggle('sd-Menu-active-1TqKc', on);
          }
        }
        document.body.append(panel);
      });
      // 至今 takes the end's two lists off the page, and unticking it puts them back.
      box.addEventListener('change', (e) => {
        const still = (e.target as HTMLInputElement).closest('.sign-MhIus99jyR input[type=checkbox]') as HTMLInputElement | null;
        const end = still?.closest('.month-range-select')?.querySelector<HTMLElement>('.span-end');
        if (!still || !end) return;
        if (still.checked) {
          (end as HTMLElement & { kept?: string }).kept = end.innerHTML;
          end.replaceChildren();
        } else end.innerHTML = (end as HTMLElement & { kept?: string }).kept ?? '';
      });
    },
    [form, lists] as const,
  );
}

const mokaField = (title: string) => page.locator('[class^="apply-field-"]', { has: page.locator(`[class^="title-"]:has-text("${title}")`) });
const shown = (title: string) => mokaField(title).locator('[class*="sd-Input-display-value"]');

test.describe('Moka', () => {
  test('a month on its panel', async () => {
    await mountMoka({});
    const r = await execIntent(page, '出生日期 (年龄)', { kind: 'date', ...month(2000, 5) });
    expect(r.outcome).toBe('filled');
    await expect(mokaField('出生日期').locator('input')).toHaveValue('2000-05');
    await expect(page.locator('.sd-Dropdown-dropdown-GmACl')).toHaveCount(0);
  });

  test('the same year with another month still there is not a month taken', async () => {
    await mountMoka({});
    await mokaField('出生日期').locator('input').evaluate((i: HTMLInputElement) => {
      i.value = '2000-03';
      (window as unknown as { ignoreMonth: boolean }).ignoreMonth = true;
    });
    const r = await execIntent(page, '出生日期 (年龄)', { kind: 'date', ...month(2000, 5) });
    expect(r.outcome).not.toBe('filled');
    await expect(page.locator('.sd-Dropdown-dropdown-GmACl')).toHaveCount(0);
  });

  test('a search that finds nothing leaves no words in the box', async () => {
    await mountMoka({});
    const r = await execIntent(page, '学校名称', choice('浙江大学'));
    expect(r.outcome).toBe('no_option');
    await expect(mokaField('学校名称').locator('input')).toHaveValue('');
  });

  test('a list picks what fits, and the box itself stays empty', async () => {
    await mountMoka({ 最高学历: ['本科', '硕士', '博士', '大专'] });
    const r = await execIntent(page, '最高学历', choice('硕士'));
    expect(r.outcome).toBe('filled');
    await expect(shown('最高学历')).toHaveText('硕士');
    await expect(mokaField('最高学历').locator('input')).toHaveValue('');
    await expect(page.locator('.sd-Dropdown-dropdown-GmACl')).toHaveCount(0);
  });

  test('nothing fitting picks nothing', async () => {
    await mountMoka({ 最高学历: ['本科', '硕士'] });
    const r = await execIntent(page, '最高学历', choice('博士'));
    expect(r.outcome).toBe('no_option');
    await expect(shown('最高学历')).toHaveText('');
    await expect(page.locator('.sd-Dropdown-dropdown-GmACl')).toHaveCount(0);
  });

  test('year and month, in their two lists', async () => {
    await mountMoka({ 年: YEARS, 月: MONTHS });
    const r = await execIntent(page, '毕业时间', { kind: 'date', ...month(2026, 11) });
    expect(r.outcome).toBe('filled');
    await expect(shown('毕业时间')).toHaveText(['2026', '11']);
  });

  test('a list that takes several ticks every answer on it, leaves the rest, and is shut after', async () => {
    await mountMoka({ 语言技能: ['甲语', '乙语', '丙语'] });
    const multi = { kind: 'multi' as const, display: '', items: [{ query: '甲语' }, { query: '丁语' }, { query: '丙语' }] };
    const r = await execIntent(page, '语言技能', multi);
    // One answer is not on the list, so the applicant is asked to look, with the ticks that were made kept.
    expect(r.outcome).toBe('needs_review');
    expect(r.observed).toBe('甲语、丙语');
    await expect(mokaField('语言技能').locator('[class*="sd-Tag-text"]')).toHaveText(['甲语', '丙语']);
    await expect(mokaField('语言技能').locator('input')).toHaveValue('');
    await expect(page.locator('[class*="sd-Dropdown-dropdown"]')).toHaveCount(0);
  });

  test('a list that takes several with every answer on it is filled', async () => {
    await mountMoka({ 语言技能: ['甲语', '乙语', '丙语'] });
    const r = await execIntent(page, '语言技能', { kind: 'multi', display: '', items: [{ query: '甲语' }, { query: '丙语' }] });
    expect(r.outcome).toBe('filled');
    await expect(mokaField('语言技能').locator('[class*="sd-Tag-text"]')).toHaveText(['甲语', '丙语']);
  });

  test('a tick already there is not clicked off again', async () => {
    await mountMoka({ 语言技能: ['甲语', '乙语'] });
    const multi = { kind: 'multi' as const, display: '', items: [{ query: '甲语' }] };
    await execIntent(page, '语言技能', multi);
    const r = await execIntent(page, '语言技能', multi);
    expect(r.outcome).toBe('filled');
    await expect(mokaField('语言技能').locator('[class*="sd-Tag-text"]')).toHaveText(['甲语']);
  });

  test('a list that takes several with none of the answers on it picks nothing', async () => {
    await mountMoka({ 语言技能: ['甲语', '乙语'] });
    const r = await execIntent(page, '语言技能', { kind: 'multi', display: '', items: [{ query: '丁语' }] });
    expect(r.outcome).toBe('no_option');
    await expect(mokaField('语言技能').locator('[class*="sd-Tag-text"]')).toHaveCount(0);
    await expect(page.locator('[class*="sd-Dropdown-dropdown"]')).toHaveCount(0);
  });

  test('a job still going takes its start and ticks 至今', async () => {
    await mountMoka({ 年: YEARS, 月: MONTHS });
    const r = await execIntent(page, '起止时间', { kind: 'dateFrom', display: '', start: month(2025, 11) });
    expect(r.outcome).toBe('filled');
    await expect(shown('起止时间')).toHaveText(['2025', '11']);
    await expect(mokaField('起止时间').locator('input[type=checkbox]')).toBeChecked();
    expect(r.observed).toBe('2025-11 ~ 至今');
  });

  test('a finished job on a span that says 至今 has the box unticked, and takes its end', async () => {
    await mountMoka({ 年: YEARS, 月: MONTHS });
    await mokaField('起止时间').locator('input[type=checkbox]').check();
    const r = await execIntent(page, '起止时间', { kind: 'dateRange', display: '', start: month(2023, 6), end: month(2023, 9) });
    expect(r.outcome).toBe('filled');
    await expect(mokaField('起止时间').locator('input[type=checkbox]')).not.toBeChecked();
    await expect(shown('起止时间')).toHaveText(['2023', '6', '2023', '9']);
  });

  test('a span takes all four', async () => {
    await mountMoka({ 年: YEARS, 月: MONTHS });
    const r = await execIntent(page, '就读时间', { kind: 'dateRange', display: '', start: month(2025, 2), end: month(2026, 11) });
    expect(r.outcome).toBe('filled');
    await expect(shown('就读时间')).toHaveText(['2025', '2', '2026', '11']);
  });

  test('still going on a span with no 至今: nothing is written, and it asks', async () => {
    await mountMoka({ 年: YEARS, 月: MONTHS });
    const r = await execIntent(page, '就读时间', { kind: 'dateFrom', display: '', start: month(2025, 2) });
    expect(r.outcome).toBe('needs_review');
    await expect(shown('就读时间')).toHaveText(['', '', '', '']);
    await expect(page.locator('.sd-Dropdown-dropdown-GmACl')).toHaveCount(0);
  });
});

// ---- sections that take several entries -------------------------------------------------------------------------

const fillEntries = (runs = 1) => fillCnEntries(page, runs);

/** Every entry of a Moka section, as title → what it shows. A span reads year/month ~ year/month, and 至今 when ticked. */
function mokaEntries(section: string): Promise<Record<string, string>[]> {
  return page.evaluate((title) => {
    const block = Array.from(document.querySelectorAll('[class*="apply-block-"]')).find(
      (b) => b.querySelector('[class*="blockTitle-"] span span')?.textContent === title,
    );
    if (!block) throw new Error(`no section ${title}`);
    const shown = (el: Element) => el.querySelector('[class*="sd-Input-display-value"]')?.textContent?.trim() ?? '';
    return Array.from(block.querySelectorAll('[class*="apply-fields-"][class*="multi-"]')).map((entry) =>
      Object.fromEntries(
        Array.from(entry.querySelectorAll('[class*="apply-field-"]')).map((field) => {
          const name = field.querySelector('[class*="title-"]')!.textContent!.trim();
          const span = field.querySelector('.month-range-select');
          if (span) {
            const parts = Array.from(span.querySelectorAll('label[class*="sd-Select-container"]')).map(shown);
            const till = span.querySelector<HTMLInputElement>('input[type=checkbox]')?.checked ? ' 至今' : '';
            return [name, `${parts.slice(0, 2).join('/')}${parts.length > 2 ? ` ~ ${parts.slice(2).join('/')}` : ''}${till}`];
          }
          const select = field.querySelector('label[class*="sd-Select-container"]');
          if (select) return [name, shown(select)];
          return [name, field.querySelector<HTMLInputElement | HTMLTextAreaElement>('input, textarea')!.value];
        }),
      ),
    );
  }, section);
}

const MOKA_LISTS = { 学历: ['本科', '硕士', '博士'], 学校名称: ['示例大学', '示例研究院'], 专业名称: ['示例工程', '示例科学'], 年: YEARS, 月: MONTHS };

test.describe('Moka entries', () => {
  test('two schools, two internships, a project and an award, each in an entry of its own', async () => {
    await mountMoka(MOKA_LISTS, MOKA_ENTRY_FORM);
    const rows = await fillEntries();
    expect(await mokaEntries('教育背景')).toEqual([
      { 学历: '本科', 学校名称: '示例大学', 专业名称: '示例工程', 就读时间: '2019/9 ~ 2023/6' },
      { 学历: '硕士', 学校名称: '示例研究院', 专业名称: '示例科学', 就读时间: '2023/9 ~ 2026/6' },
    ]);
    expect(await mokaEntries('工作经历')).toEqual([
      { 公司名称: '示例科技有限公司', 职位名称: '示例实习生', 起止时间: '2022/7 ~ 2022/9', 工作职责: '示例工作内容一。' },
      { 公司名称: '样例数据有限公司', 职位名称: '样例分析实习生', 起止时间: '2025/10 至今', 工作职责: '示例工作内容二。' },
    ]);
    expect(await mokaEntries('项目经验')).toEqual([
      expect.objectContaining({ 项目名称: '示例项目', 起止时间: '2021/3 ~ 2021/6', 项目描述: '示例项目描述。' }),
    ]);
    expect(await mokaEntries('获奖情况')).toEqual([{ 奖项名称: '示例奖学金', 获奖时间: '2021/10' }]);
    // A project's duties are a long answer: drafted for the side panel, written only when the applicant says so.
    expect(rows.filter((r) => r.note === 'draft')).toEqual([{ outcome: 'needs_review', fieldKey: 'projects.duties', label: '项目中职责', note: 'draft' }]);
    expect(rows.filter((r) => r.note !== 'draft' && (r.outcome === 'action_failed' || r.outcome === 'needs_review'))).toEqual([]);
  });

  test('an entry the page already holds is left as it is, and the resume’s go into entries of their own', async () => {
    await mountMoka(MOKA_LISTS, MOKA_ENTRY_FORM);
    await page.evaluate(() => {
      const entryOf = (title: string) =>
        Array.from(document.querySelectorAll('[class*="apply-block-"]'))
          .find((b) => b.querySelector('[class*="blockTitle-"] span span')?.textContent === title)!
          .querySelector('[class*="apply-fields-"]')!;
      // Someone's own school, which the resume does not have.
      const school = entryOf('教育背景').querySelectorAll('[class*="sd-Input-display-value"]');
      school[0]!.textContent = '博士';
      school[1]!.textContent = '他人大学';
      // The resume's second internship, as the page keeps it, with a title of its own.
      const job = entryOf('工作经历').querySelectorAll<HTMLInputElement>('input[type=text]:not([class*="has-addon"])');
      job[0]!.value = '样例数据有限公司';
      job[1]!.value = '原有职位';
    });
    const rows = await fillEntries();
    const [held, ...schools] = await mokaEntries('教育背景');
    expect(held).toEqual({ 学历: '博士', 学校名称: '他人大学', 专业名称: '', 就读时间: '/ ~ /' });
    expect(schools.map((s) => s['学校名称'])).toEqual(['示例大学', '示例研究院']);
    expect(await mokaEntries('工作经历')).toEqual([
      { 公司名称: '样例数据有限公司', 职位名称: '原有职位', 起止时间: '/ ~ /', 工作职责: '' },
      { 公司名称: '示例科技有限公司', 职位名称: '示例实习生', 起止时间: '2022/7 ~ 2022/9', 工作职责: '示例工作内容一。' },
    ]);
    expect(rows.filter((r) => r.outcome === 'action_failed')).toEqual([]);
  });

  test('run again, it adds nothing', async () => {
    await mountMoka(MOKA_LISTS, MOKA_ENTRY_FORM);
    await fillEntries(2);
    for (const [section, count] of [['教育背景', 2], ['工作经历', 2], ['项目经验', 1], ['获奖情况', 1]] as const) {
      expect(await mokaEntries(section), section).toHaveLength(count);
    }
  });
});

/**
 * A date box keeps what was typed only on Enter, and takes it back on leaving otherwise. A search box lists the
 * `found` that hold what was typed. 添加 under a section's cards puts an empty card above itself.
 */
async function mountFeishu(options: string[], form = FEISHU_FORM, found: string[] = []): Promise<void> {
  await page.evaluate(
    ([html, items, searchable]) => {
      const box = document.createElement('div');
      box.innerHTML = html as string;
      document.body.replaceChildren(box);
      const wireDates = (root: Element) => {
        for (const i of root.querySelectorAll<HTMLInputElement>('.ud__picker input, .throne-biz-date-range-picker-wrapper input')) {
          i.addEventListener('keydown', (e) => {
            if ((e as KeyboardEvent).key === 'Enter' && i.value) i.dataset['kept'] = i.value;
          });
          i.closest('.ud__input')?.querySelector('.ud__input__clear-icon')?.addEventListener('click', () => {
            i.dataset['kept'] = '';
            i.value = '';
          });
          i.addEventListener('blur', () => {
            i.value = i.dataset['kept'] ?? '';
          });
        }
      };
      const LIST = '.apply-form-array-card__1d6856';
      const blank = new Map<Element, string>();
      for (const list of box.querySelectorAll(LIST)) blank.set(list, list.querySelector('.apply-form-array-card-content__1d6856')!.outerHTML);
      box.addEventListener('click', (e) => {
        const add = (e.target as Element).closest('button.ud__button');
        const list = add?.closest(LIST);
        if (!add || !list || !blank.has(list)) return;
        add.insertAdjacentHTML('beforebegin', blank.get(list)!);
        wireDates(add.previousElementSibling!);
      });
      box.addEventListener('input', (e) => {
        const input = e.target as HTMLInputElement;
        const select = input.closest('.ud__select');
        if (!select || select.querySelector('.ud__select__selector') || input.readOnly) return;
        document.querySelectorAll('.ud__select__dropdown').forEach((p) => p.remove());
        const hits = (searchable as string[]).filter((s) => input.value && s.includes(input.value));
        if (hits.length === 0) return;
        const panel = document.createElement('div');
        panel.className = 'ud__select__dropdown';
        panel.innerHTML = `<div class="ud__select__list">${hits.map((o) => `<div class="ud__select__list__item"><div><span><span>${o}</span></span></div></div>`).join('')}</div>`;
        panel.addEventListener('click', (ev) => {
          const row = (ev.target as Element).closest('.ud__select__list__item');
          if (!row) return;
          input.value = row.textContent!.trim();
          panel.remove();
        });
        document.body.append(panel);
      });
      const closePanels = () => document.querySelectorAll('.ud__select__dropdown').forEach((p) => p.remove());
      document.addEventListener('mousedown', (e) => {
        if (!(e.target as Element).closest('.ud__select__dropdown')) closePanels();
      });
      box.addEventListener('click', (e) => {
        const selector = (e.target as Element).closest<HTMLElement>('.ud__select__selector');
        if (!selector) return;
        (window as unknown as { opened: number }).opened = ((window as unknown as { opened?: number }).opened ?? 0) + 1;
        closePanels();
        const panel = document.createElement('div');
        panel.className = 'ud__select__dropdown';
        panel.innerHTML = `<div class="ud__select__list">${(items as string[]).map((o) => `<div class="ud__select__list__item"><div><span><span>${o}</span></span></div></div>`).join('')}</div>`;
        panel.addEventListener('click', (ev) => {
          const row = (ev.target as Element).closest('.ud__select__list__item');
          if (!row) return;
          const content = selector.querySelector('.ud__select__selector__content')!;
          content.querySelector('.ud__select__selector__selectItem')?.remove();
          const chosen = document.createElement('div');
          chosen.className = 'ud__select__selector__selectItem';
          chosen.textContent = row.textContent!.trim();
          content.prepend(chosen);
          closePanels();
        });
        document.body.append(panel);
      });
      wireDates(box);
    },
    [form, options, found] as const,
  );
}

/** Every card of a Feishu section, as label → what it shows. A span reads start ~ end. */
function feishuEntries(section: string): Promise<Record<string, string>[]> {
  return page.evaluate((title) => {
    const module = Array.from(document.querySelectorAll('.applyFormModuleWrapper__d8a302')).find(
      (m) => m.querySelector('.applyFormModuleWrapper-text')?.textContent === title,
    );
    if (!module) throw new Error(`no section ${title}`);
    return Array.from(module.querySelectorAll('.apply-form-array-card-content__1d6856')).map((card) =>
      Object.fromEntries(
        Array.from(card.querySelectorAll('.ud-formily-item')).map((it) => {
          const name = it.querySelector('.ud-formily-item-label label')!.textContent!.trim();
          const chosen = it.querySelector('.ud__select__selector');
          if (chosen) return [name, chosen.querySelector('.ud__select__selector__selectItem')?.textContent ?? ''];
          const boxes = Array.from(it.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('input, textarea')).map((i) => i.value);
          return [name, boxes.join(' ~ ')];
        }),
      ),
    );
  }, section);
}

const FEISHU_LISTS = ['本科', '硕士', '博士', '全日制', '非全日制'];
const SCHOOLS = ['示例大学', '示例研究院'];

test.describe('Feishu entries', () => {
  test('two schools, two internships, a project and an award, each in a card of its own', async () => {
    await mountFeishu(FEISHU_LISTS, FEISHU_ENTRY_FORM, SCHOOLS);
    const rows = await fillEntries();
    expect(await feishuEntries('教育经历')).toEqual([
      expect.objectContaining({ 学校名称: '示例大学', 学历: '本科', 专业: '示例工程', 起止时间: '2019-09 ~ 2023-06' }),
      expect.objectContaining({ 学校名称: '示例研究院', 学历: '硕士', 专业: '示例科学', 起止时间: '2023-09 ~ 2026-06' }),
    ]);
    // Still going: the start goes in, and the end is the applicant's to say on a form with no word for it.
    expect(await feishuEntries('实习经历')).toEqual([
      { 公司名称: '示例科技有限公司', 职位名称: '示例实习生', 起止时间: '2022-07 ~ 2022-09', 描述: '示例工作内容一。' },
      { 公司名称: '样例数据有限公司', 职位名称: '样例分析实习生', 起止时间: '2025-10 ~ ', 描述: '示例工作内容二。' },
    ]);
    expect(await feishuEntries('项目经历')).toEqual([
      expect.objectContaining({ 项目名称: '示例项目', 起止时间: '2021-03 ~ 2021-06', 描述: '示例项目描述。' }),
    ]);
    expect(await feishuEntries('获奖经历')).toEqual([{ 奖项名称: '示例奖学金', 获奖时间: '2021-10', 描述: '' }]);
    expect(rows.filter((r) => r.outcome === 'action_failed')).toEqual([]);
  });

  test('a card the page already holds is left as it is, and run again nothing more is added', async () => {
    await mountFeishu(FEISHU_LISTS, FEISHU_ENTRY_FORM, SCHOOLS);
    await page.locator('.ud-formily-item[data-form-field-name="company"] input').first().fill('他人公司');
    await fillEntries(2);
    const jobs = await feishuEntries('实习经历');
    expect(jobs.map((j) => j['公司名称'])).toEqual(['他人公司', '示例科技有限公司', '样例数据有限公司']);
    expect(jobs[0]).toEqual({ 公司名称: '他人公司', 职位名称: '', 起止时间: ' ~ ', 描述: '' });
    for (const [section, count] of [['教育经历', 2], ['项目经历', 1], ['获奖经历', 1]] as const) {
      expect(await feishuEntries(section), section).toHaveLength(count);
    }
  });
});

const feishuItem = (name: string) => page.locator(`.ud-formily-item[data-form-field-name="${name}"]`).first();
const spanBoxes = () => feishuItem('start_end_time').locator('input');

test.describe('Feishu', () => {
  test('a read-only list picks by clicking its row', async () => {
    await mountFeishu(['博士', '硕士', '本科']);
    const r = await execIntent(page, '学历', choice('硕士'), { nth: 0 });
    expect(r.outcome).toBe('filled');
    await expect(feishuItem('degree').locator('.ud__select__selector__selectItem')).toHaveText('硕士');
    await expect(page.locator('.ud__select__dropdown')).toHaveCount(0);
  });

  test('nothing fitting picks nothing, and the list is shut again', async () => {
    await mountFeishu(['博士', '本科']);
    const r = await execIntent(page, '学历', choice('硕士'), { nth: 0 });
    expect(r.outcome).toBe('no_option');
    await expect(feishuItem('degree').locator('.ud__select__selector__selectItem')).toHaveCount(0);
    await expect(page.locator('.ud__select__dropdown')).toHaveCount(0);
  });

  test('an answer already there is left alone, with no list opened', async () => {
    await mountFeishu(['博士', '硕士']);
    await feishuItem('degree').locator('.ud__select__selector__content').evaluate((content) => {
      const chosen = document.createElement('div');
      chosen.className = 'ud__select__selector__selectItem';
      chosen.textContent = '硕士';
      content.prepend(chosen);
    });
    const r = await execIntent(page, '学历', choice('硕士'), { nth: 0 });
    expect(r.outcome).toBe('filled');
    expect(await page.evaluate(() => (window as unknown as { opened?: number }).opened ?? 0)).toBe(0);
  });

  const place = (query: string, ...wider: string[]) => ({ kind: 'choice', display: query, query, wider }) as const;
  const degreeShown = () => feishuItem('degree').locator('.ud__select__selector__selectItem');
  const opened = () => page.evaluate(() => (window as unknown as { opened?: number }).opened ?? 0);
  const alreadyThere = (text: string) =>
    feishuItem('degree').locator('.ud__select__selector__content').evaluate((content, t) => {
      const chosen = document.createElement('div');
      chosen.className = 'ud__select__selector__selectItem';
      chosen.textContent = t;
      content.prepend(chosen);
    }, text);

  test('a place already there at a wider level of the resume is left alone, with no list opened', async () => {
    await mountFeishu(['四川', '辽宁']);
    await alreadyThere('四川');
    const r = await execIntent(page, '学历', place('武侯区', '成都市', '四川'), { nth: 0 });
    expect(r.outcome).toBe('filled');
    await expect(degreeShown()).toHaveText('四川');
    expect(await opened()).toBe(0);
  });

  test('an empty box takes the narrowest level on the list', async () => {
    await mountFeishu(['绵阳市', '成都市', '四川', '辽宁']);
    const r = await execIntent(page, '学历', place('武侯区', '成都市', '四川'), { nth: 0 });
    expect(r.outcome).toBe('filled');
    await expect(degreeShown()).toHaveText('成都市');
    await expect(page.locator('.ud__select__dropdown')).toHaveCount(0);
  });

  test('an empty search box walks up within the time a step has, and no words stay behind', async () => {
    await mountFeishu(['四川', '辽宁']);
    // A real search list: nothing until something is typed, and only what fits, a moment later.
    await feishuItem('degree').locator('input').evaluate((input: HTMLInputElement) => {
      input.removeAttribute('readonly');
      const typed: string[] = [];
      (window as unknown as { typed: string[] }).typed = typed;
      const sync = () => {
        for (const row of document.querySelectorAll<HTMLElement>('.ud__select__dropdown .ud__select__list__item')) {
          row.hidden = !input.value || !row.textContent!.includes(input.value);
        }
      };
      new MutationObserver(sync).observe(document.body, { childList: true });
      input.addEventListener('input', () => {
        typed.push(input.value);
        setTimeout(sync, 100);
      });
    });
    const r = await execIntent(page, '学历', place('武侯区', '成都市', '四川'), { nth: 0 });
    expect(r.outcome).toBe('filled');
    await expect(degreeShown()).toHaveText('四川');
    // Each level that found nothing took its words back out before the next one was typed.
    const typed = await page.evaluate(() => (window as unknown as { typed: string[] }).typed);
    // Typing arrives a letter at a time: keep where each word ended.
    const words = typed.filter((v, i) => v === '' || !typed[i + 1]?.startsWith(v));
    expect(words).toEqual(['武侯区', '', '成都市', '', '四川']);
  });

  test('an empty box takes the next answer in the resume when the first is not on the list', async () => {
    await mountFeishu(['北京', '杭州']);
    const r = await execIntent(page, '学历', { kind: 'choice', display: '上海', query: '上海', fallbacks: ['深圳', '杭州'] }, { nth: 0 });
    expect(r.outcome).toBe('filled');
    await expect(degreeShown()).toHaveText('杭州');
    await expect(page.locator('.ud__select__dropdown')).toHaveCount(0);
  });

  test('an empty box with no level on the list stays empty', async () => {
    await mountFeishu(['辽宁']);
    const r = await execIntent(page, '学历', place('武侯区', '成都市', '四川'), { nth: 0 });
    expect(r.outcome).toBe('no_option');
    await expect(degreeShown()).toHaveCount(0);
  });

  test('another answer already there is kept and left to check, not swapped for a wider level', async () => {
    await mountFeishu(['四川', '辽宁']);
    await alreadyThere('堪培拉');
    const r = await execIntent(page, '学历', place('武侯区', '成都市', '四川'), { nth: 0 });
    expect(r.outcome).toBe('needs_review');
    await expect(degreeShown()).toHaveText('堪培拉');
    await expect(page.locator('.ud__select__dropdown')).toHaveCount(0);
  });

  test('a span takes both ends, and they stay after leaving the box', async () => {
    await mountFeishu([]);
    const r = await execIntent(page, '起止时间', { kind: 'dateRange', display: '', start: month(2025, 2), end: month(2026, 12) }, { nth: 0 });
    expect(r.outcome).toBe('filled');
    await expect(spanBoxes().first()).toHaveValue('2025-02');
    await expect(spanBoxes().nth(1)).toHaveValue('2026-12');
  });

  test('still going: the start goes in, the old end comes out, and it asks about the end', async () => {
    await mountFeishu([]);
    await spanBoxes().nth(1).fill('2025-10');
    await spanBoxes().nth(1).press('Enter');
    const r = await execIntent(page, '起止时间', { kind: 'dateFrom', display: '', start: month(2026, 7) }, { nth: 0 });
    expect(r.outcome).toBe('needs_review');
    await expect(spanBoxes().first()).toHaveValue('2026-07');
    await expect(spanBoxes().nth(1)).toHaveValue('');
  });
});

// Moka's place panel as read off a live form: tabs for 省份, 城市 and 县区, a word for each place, and every click
// written straight into the box. 确认 only closes it.
const SICHUAN = {
  北京市: { 北京市: ['东城区'] },
  四川: {
    绵阳市: ['涪城区'],
    // The list keeps a retired name with （旧） after it, sometimes beside the new place of the same name.
    成都市: ['锦江区', '青羊区', '武侯区', '金牛区', '成华区', '成都高新技术产业开发区', '简阳市', '新都县（旧）', '双流县（旧）', '双流县'],
    凉山彝族自治州: ['西昌市'],
  },
};

async function mountPlace(): Promise<void> {
  await mountMoka({});
  await page.evaluate((tree) => {
    const field = Array.from(document.querySelectorAll('[class^="apply-field-"]')).find((f) => f.textContent!.includes('籍贯'))!;
    const owner = field.querySelector('[class*="sd-Dropdown-container"]')!;
    const input = field.querySelector('input')!;
    const close = () => owner.querySelector('[class*="sd-Dropdown-dropdown"]')?.remove();
    document.addEventListener('mousedown', (e) => {
      if (!owner.contains(e.target as Node)) close();
    });
    const tags = (names: string[]) => names.map((n) => `<span class="sd-Tag-container"><span class="sd-Tag-text-2nFJX">${n}</span></span>`).join('');
    owner.querySelector('label')!.addEventListener('click', () => {
      if (owner.querySelector('[class*="sd-Dropdown-dropdown"]')) return;
      (window as unknown as { placeOpened: number }).placeOpened = ((window as unknown as { placeOpened?: number }).placeOpened ?? 0) + 1;
      const panel = document.createElement('div');
      panel.className = 'sd-Dropdown-dropdown-x';
      const province = Object.keys(tree);
      panel.innerHTML = `<div class="menu-wrapper-z"><div class="levels">${tags(['北京市'])}${tags(province)}</div><div class="confirm-q"><button type="button">确认</button></div></div>`;
      const levels = panel.querySelector<HTMLElement>('.levels')!;
      const picked: string[] = [];
      panel.addEventListener('click', (e) => {
        e.stopPropagation();
        if ((e.target as Element).closest('button')) return close();
        const tag = (e.target as Element).closest('[class*="sd-Tag-text"]');
        if (!tag) return;
        const name = tag.textContent!;
        picked.push(name);
        // A page that loses a level on the way: the last one is right and the box is still wrong.
        input.value = (window as unknown as { dropFirst?: boolean }).dropFirst ? picked.slice(1).join(' ') : picked.join(' ');
        if (picked.length === 1) levels.innerHTML = tags(Object.keys((tree as Record<string, Record<string, string[]>>)[name]!));
        else if (picked.length === 2) levels.innerHTML = tags((tree as Record<string, Record<string, string[]>>)[picked[0]!]![name]!);
        else close();
      });
      owner.append(panel);
    });
  }, SICHUAN);
}

const cascade = (...path: string[]) => ({ kind: 'cascade', display: path.join(' '), path }) as const;
const placeBox = () => mokaField('籍贯').locator('input');

test.describe('Moka places', () => {
  test('down to the city, with 省 and 市 written or not', async () => {
    await mountPlace();
    const r = await execIntent(page, '籍贯', cascade('四川省', '成都市'));
    expect(r.outcome).toBe('filled');
    await expect(placeBox()).toHaveValue('四川 成都市');
    await expect(page.locator('[class*="sd-Dropdown-dropdown"]')).toHaveCount(0);
  });

  test('down to a district on the list', async () => {
    await mountPlace();
    const r = await execIntent(page, '籍贯', cascade('四川省', '成都市', '武侯区'));
    expect(r.outcome).toBe('filled');
    await expect(placeBox()).toHaveValue('四川 成都市 武侯区');
  });

  test('a district written without its 区 or 县 is still that district', async () => {
    await mountPlace();
    const r = await execIntent(page, '籍贯', cascade('四川省', '成都市', '武侯'));
    expect(r.outcome).toBe('filled');
    await expect(placeBox()).toHaveValue('四川 成都市 武侯区');
  });

  test('a district that is not on the list stops at the city and leaves that to check', async () => {
    await mountPlace();
    const r = await execIntent(page, '籍贯', cascade('四川省', '成都市', '高新区'));
    expect(r.outcome).toBe('needs_review');
    await expect(placeBox()).toHaveValue('四川 成都市');
    await expect(page.locator('[class*="sd-Dropdown-dropdown"]')).toHaveCount(0);
  });

  test('a province that is not there picks nothing', async () => {
    await mountPlace();
    const r = await execIntent(page, '籍贯', cascade('澳大利亚首都领地', '堪培拉'));
    expect(r.outcome).toBe('no_option');
    await expect(placeBox()).toHaveValue('');
    await expect(page.locator('[class*="sd-Dropdown-dropdown"]')).toHaveCount(0);
  });

  test('every level is checked in the box, not only the last', async () => {
    await mountPlace();
    await page.evaluate(() => {
      (window as unknown as { dropFirst: boolean }).dropFirst = true;
    });
    const r = await execIntent(page, '籍贯', cascade('四川省', '成都市', '武侯区'));
    expect(r.outcome).not.toBe('filled');
  });

  test('a district the list keeps as retired is still that district', async () => {
    await mountPlace();
    const r = await execIntent(page, '籍贯', cascade('四川省', '成都市', '新都县'));
    expect(r.outcome).toBe('filled');
    await expect(placeBox()).toHaveValue('四川 成都市 新都县（旧）');
  });

  test('a place that has a retired twin of the same name is the one in use', async () => {
    await mountPlace();
    const r = await execIntent(page, '籍贯', cascade('四川省', '成都市', '双流县'));
    expect(r.outcome).toBe('filled');
    await expect(placeBox()).toHaveValue('四川 成都市 双流县');
  });

  test('an autonomous prefecture written short is still that prefecture', async () => {
    await mountPlace();
    const r = await execIntent(page, '籍贯', cascade('四川省', '凉山州', '西昌市'));
    expect(r.outcome).toBe('filled');
    await expect(placeBox()).toHaveValue('四川 凉山彝族自治州 西昌市');
  });

  test('a district already in the box under the resume’s city is left alone, with no panel opened', async () => {
    await mountPlace();
    await placeBox().evaluate((i: HTMLInputElement) => {
      i.value = '四川 成都市 武侯区';
    });
    const r = await execIntent(page, '籍贯', cascade('四川省', '成都市'));
    expect(r.outcome).toBe('filled');
    await expect(placeBox()).toHaveValue('四川 成都市 武侯区');
    expect(await page.evaluate(() => (window as unknown as { placeOpened?: number }).placeOpened ?? 0)).toBe(0);
  });

  test('another place already in the box is kept and left to check', async () => {
    await mountPlace();
    await placeBox().evaluate((i: HTMLInputElement) => {
      i.value = '北京市 北京市 东城区';
    });
    const r = await execIntent(page, '籍贯', cascade('四川省', '成都市'));
    expect(r.outcome).toBe('needs_review');
    await expect(placeBox()).toHaveValue('北京市 北京市 东城区');
  });

  test('a wider place already in the box is taken down to the resume’s district', async () => {
    await mountPlace();
    await placeBox().evaluate((i: HTMLInputElement) => {
      i.value = '四川 成都市';
    });
    const r = await execIntent(page, '籍贯', cascade('四川省', '成都市', '武侯区'));
    expect(r.outcome).toBe('filled');
    await expect(placeBox()).toHaveValue('四川 成都市 武侯区');
  });
});
