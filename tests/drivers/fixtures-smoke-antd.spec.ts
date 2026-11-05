import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Locator, type Page } from '@playwright/test';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = path.join(ROOT, 'fixtures', 'synthetic');

type State = Record<string, unknown>;

function loadExpected(page: string): { meta: State; state: State } {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES, page, 'expected.json'), 'utf8')) as State;
  const meta: State = {};
  const state: State = {};
  for (const [k, v] of Object.entries(raw)) (k.startsWith('__') ? meta : state)[k] = v;
  return { meta, state };
}

/** Empty value of the same shape: '' / false / []. */
function emptyLike(v: unknown): unknown {
  return Array.isArray(v) ? [] : typeof v === 'boolean' ? false : '';
}

declare global {
  interface Window {
    __fixtureState: () => Record<string, unknown>;
  }
}

const fixtureState = (page: Page): Promise<State> => page.evaluate(() => window.__fixtureState());

// ---- antd interaction helpers (real user actions) -------------------------------------------------

/**
 * antd keeps a closed popup visible for its leave animation, so two dropdowns can match at once.
 * Wait until none is visible before opening the next one.
 */
const popupsClosed = (page: Page) => expect(page.locator('.ant-select-dropdown:visible')).toHaveCount(0);

/** Open a Select via its combobox (found by label), optionally type to search, click the option. */
async function pickSelect(page: Page, scope: Locator, label: string, option: string, search = false): Promise<void> {
  const combo = scope.getByRole('combobox', { name: label, exact: true });
  await combo.click();
  if (search) await combo.fill(option);
  await page
    .locator(`.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${option}"]`)
    .click();
  await popupsClosed(page);
}

/** Multiple select: one pick per value, in order. */
async function pickMulti(page: Page, scope: Locator, label: string, options: string[]): Promise<void> {
  const combo = scope.getByRole('combobox', { name: label, exact: true });
  await combo.click();
  for (const option of options) {
    await page
      .locator(`.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${option}"]`)
      .click();
  }
  await page.keyboard.press('Escape');
  await popupsClosed(page);
}

/** Cascader: click each level of the path in the open popup. */
async function pickCascader(page: Page, scope: Locator, label: string, pathLabels: string[]): Promise<void> {
  await scope.getByRole('combobox', { name: label, exact: true }).click();
  for (const step of pathLabels) {
    await page
      .locator(`.ant-cascader-dropdown:not(.ant-select-dropdown-hidden) .ant-cascader-menu-item[title="${step}"]`)
      .click();
  }
  await popupsClosed(page);
}

/** DatePicker: type the value into the input and confirm with Enter. */
async function typeDate(scope: Locator, label: string, value: string): Promise<void> {
  const input = scope.getByLabel(label, { exact: true });
  await input.click();
  await input.fill(value);
  await input.press('Enter');
}

const section = (page: Page, title: string): Locator =>
  page.locator('.ant-card:not(.ant-card-type-inner)').filter({
    has: page.locator('.ant-card-head-title', { hasText: new RegExp(`^${title}$`) }),
  });

const entry = (page: Page, title: string): Locator =>
  page.locator('.ant-card-type-inner').filter({
    has: page.locator('.ant-card-head-title', { hasText: new RegExp(`^${title}$`) }),
  });

test.describe('antd fixture (zh-CN)', () => {
  const { meta, state: expected } = loadExpected('antd');
  const e = expected as Record<string, string | boolean | string[]>;
  const s = (k: string) => e[k] as string;
  const list = (k: string) => e[k] as string[];

  test('initial __fixtureState is all-empty with 1 education / 2 internship / 1 project / 1 award cards', async ({ page }) => {
    await page.goto('/antd/');
    await page.getByLabel('姓名', { exact: true }).waitFor();
    const initial = await fixtureState(page);

    const expectedInitialKeys = Object.keys(expected).filter((k) => !k.startsWith('education[1].'));
    expect(Object.keys(initial).sort()).toEqual(expectedInitialKeys.sort());
    for (const [k, v] of Object.entries(initial)) expect(v, k).toEqual(emptyLike(expected[k]));
    await expect(page.locator('.ant-card-type-inner')).toHaveCount(1 + 2 + 1 + 1);
  });

  test('"+ 添加教育经历" appends an identical education card', async ({ page }) => {
    await page.goto('/antd/');
    await page.getByRole('button', { name: '+ 添加教育经历' }).click();
    await expect(entry(page, '教育经历 2')).toBeVisible();
    const state = await fixtureState(page);
    for (const k of ['school', 'degree', 'major', 'startDate', 'endDate', 'gpa', 'ranking']) {
      expect(state).toHaveProperty([`education[1].${k}`]);
    }
  });

  test('外语语种 select cannot hold the resume language', async ({ page }) => {
    await page.goto('/antd/');
    await page.getByRole('combobox', { name: '外语语种', exact: true }).click();
    const labels = await page
      .locator('.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option')
      .evaluateAll((els) => els.map((el) => el.getAttribute('title')));
    expect(labels).toEqual(['日语', '韩语', '法语']);
    expect(labels).not.toContain('英语');
    expect(meta.__review).toEqual(['foreignLanguage']);
  });

  test('filling the form with Playwright reproduces expected.json', async ({ page }) => {
    await page.goto('/antd/');
    await page.getByLabel('姓名', { exact: true }).waitFor();

    // 基本信息
    const basics = section(page, '基本信息');
    await basics.getByLabel('姓名', { exact: true }).fill(s('name'));
    await basics.getByLabel(s('gender'), { exact: true }).check();
    await typeDate(basics, '出生日期', s('birthDate'));
    await pickSelect(page, basics, '民族', s('ethnicity'), true);
    await pickSelect(page, basics, '政治面貌', s('politicalStatus'));
    // The country-code select lives in the phone input's addon and has no label of its own.
    await basics.locator('.ant-input-group-addon .ant-select').click();
    await page
      .locator(`.ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option[title="${s('phoneCountryCode')}"]`)
      .click();
    await popupsClosed(page);
    await basics.getByLabel('手机号码', { exact: true }).fill(s('phone'));
    await basics.getByLabel('电子邮箱', { exact: true }).fill(s('email'));
    await basics.getByLabel('身份证号', { exact: true }).fill(s('idNumber'));
    await basics.getByLabel('微信号', { exact: true }).fill(s('wechat'));
    // QQ stays empty (no data in the resume).
    await pickCascader(page, basics, '籍贯', list('nativePlace'));
    await pickCascader(page, basics, '现居住地', list('currentLocation'));

    // 求职意向
    const intent = section(page, '求职意向');
    await intent.getByLabel('期望职位', { exact: true }).fill(s('expectedPosition'));
    await pickMulti(page, intent, '期望城市', list('expectedCities'));
    await intent.getByLabel(s('acceptAdjustment'), { exact: true }).check();

    // 教育经历: one card preset, the second needs the add button.
    await page.getByRole('button', { name: '+ 添加教育经历' }).click();
    for (let i = 0; i < 2; i++) {
      const card = entry(page, `教育经历 ${i + 1}`);
      await pickSelect(page, card, '学校名称', s(`education[${i}].school`), true);
      await pickSelect(page, card, '学历', s(`education[${i}].degree`));
      await card.getByLabel('专业', { exact: true }).fill(s(`education[${i}].major`));
      await typeDate(card, '入学时间', s(`education[${i}].startDate`));
      await typeDate(card, '毕业时间', s(`education[${i}].endDate`));
      if (s(`education[${i}].gpa`)) await card.getByLabel('GPA', { exact: true }).fill(s(`education[${i}].gpa`));
      if (s(`education[${i}].ranking`)) await card.getByLabel('专业排名', { exact: true }).fill(s(`education[${i}].ranking`));
    }

    // 实习经历
    for (let i = 0; i < 2; i++) {
      const card = entry(page, `实习经历 ${i + 1}`);
      await card.getByLabel('公司名称', { exact: true }).fill(s(`internship[${i}].company`));
      await card.getByLabel('职位名称', { exact: true }).fill(s(`internship[${i}].position`));
      await typeDate(card, '开始时间', s(`internship[${i}].startDate`));
      if (s(`internship[${i}].endDate`)) await typeDate(card, '结束时间', s(`internship[${i}].endDate`));
      if (e[`internship[${i}].current`]) await card.getByLabel('至今', { exact: true }).check();
      await card.getByLabel('工作内容', { exact: true }).fill(s(`internship[${i}].description`));
    }

    // 语言能力 (外语语种 is intentionally left alone: no matching option)
    const language = section(page, '语言能力');
    await pickSelect(page, language, '英语等级', s('englishLevel'));

    // 获奖情况
    const award = entry(page, '获奖情况 1');
    const project = page.locator('.ant-card-type-inner', { hasText: '项目经历 1' });
    await project.getByLabel('项目名称', { exact: true }).fill(s('project[0].name'));
    const [from, to] = s('project[0].period').split(' ~ ') as [string, string];
    await project.locator('.ant-picker-range input').nth(0).click();
    await project.locator('.ant-picker-range input').nth(0).fill(from);
    await project.locator('.ant-picker-range input').nth(0).press('Enter');
    await project.locator('.ant-picker-range input').nth(1).fill(to);
    await project.locator('.ant-picker-range input').nth(1).press('Enter');
    await award.getByLabel('奖项名称', { exact: true }).fill(s('award[0].name'));
    await typeDate(award, '获奖时间', s('award[0].date'));
    await pickSelect(page, award, '奖项级别', s('award[0].level'));

    // 附件: antd Upload keeps a hidden <input type=file> inside the trigger.
    await section(page, '附件')
      .locator('input[type="file"]')
      .setInputFiles({
        name: list('resume')[0]!,
        mimeType: 'application/pdf',
        buffer: Buffer.from('%PDF-1.4 fixture'),
      });
    await expect(page.locator('.ant-upload-list-item-name')).toHaveText(list('resume')[0]!);

    await page.getByLabel('自我评价', { exact: true }).fill(s('selfEvaluation'));
    // 推荐人工号 stays empty.

    expect(await fixtureState(page)).toEqual(expected);
  });
});
