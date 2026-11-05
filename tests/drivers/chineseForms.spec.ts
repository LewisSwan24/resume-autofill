// Moka's and Feishu's own widgets, driven on a stand-in that behaves the way the real ones were seen to: panels at
// the end of <body>, the box staying empty until something is picked. The real pages are still the real proof.
import { expect, test, type Page } from '@playwright/test';
import { FEISHU_FORM } from '../shared/feishuForm';
import { MOKA_FORM } from '../shared/mokaForm';
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

/** Lists keyed by the question's title, or by 年 and 月 for the date parts; what opens them and what picking does. */
async function mountMoka(lists: Record<string, string[]>): Promise<void> {
  await page.evaluate(
    ([html, options]) => {
      const box = document.createElement('div');
      box.innerHTML = html as string;
      document.body.replaceChildren(box);
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
        panel.addEventListener('click', (ev) => {
          const row = (ev.target as Element).closest('.sd-Menu-container-1WISQ');
          if (!row) return;
          label.querySelector('[class*="sd-Input-display-value"]')!.textContent = row.textContent!.trim();
          closePanels();
        });
        document.body.append(panel);
      });
    },
    [MOKA_FORM, lists] as const,
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

  test('a span takes all four', async () => {
    await mountMoka({ 年: YEARS, 月: MONTHS });
    const r = await execIntent(page, '就读时间', { kind: 'dateRange', display: '', start: month(2025, 2), end: month(2026, 11) });
    expect(r.outcome).toBe('filled');
    await expect(shown('就读时间')).toHaveText(['2025', '2', '2026', '11']);
  });
});

/** A date box keeps what was typed only on Enter, and takes it back on leaving otherwise. */
async function mountFeishu(options: string[]): Promise<void> {
  await page.evaluate(
    ([html, items]) => {
      const box = document.createElement('div');
      box.innerHTML = html as string;
      document.body.replaceChildren(box);
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
      for (const i of box.querySelectorAll<HTMLInputElement>('.ud__picker input, .throne-biz-date-range-picker-wrapper input')) {
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
    },
    [FEISHU_FORM, options] as const,
  );
}

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
