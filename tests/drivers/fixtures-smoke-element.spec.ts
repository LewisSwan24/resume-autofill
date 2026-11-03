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

// ---- Element Plus interaction helpers (real user actions) -----------------------------------------

const exact = (text: string): RegExp => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);

/**
 * Element Plus keeps closed poppers in the DOM (display:none after the leave transition), so only
 * count the visible ones. Wait for none before opening the next popper.
 */
const poppersClosed = (page: Page) => expect(page.locator('.el-popper:visible')).toHaveCount(0);

/** Section card (outer `el-card`) by its header text. */
const section = (page: Page, title: string): Locator =>
  page.locator('.el-card').filter({ has: page.locator('.el-card__header', { hasText: exact(title) }) });

/** Entry card inside a section ("教育经历 1"). */
const entry = (page: Page, title: string): Locator =>
  page.locator('.el-card .el-card').filter({ has: page.locator('.el-card__header', { hasText: exact(title) }) });

/** `el-form-item` by its label text, inside `scope`. */
const item = (scope: Locator, label: string): Locator =>
  scope.locator('.el-form-item').filter({ has: scope.page().locator('.el-form-item__label', { hasText: exact(label) }) });

/** Open an el-select (wrapper click), optionally search, click the option in the visible popper. */
async function pickSelect(page: Page, scope: Locator, label: string, option: string, search = false): Promise<void> {
  const field = item(scope, label);
  await field.locator('.el-select').click();
  if (search) {
    await field.getByRole('combobox').fill(option);
  }
  await page
    .locator('.el-select__popper:visible .el-select-dropdown__item')
    .filter({ hasText: exact(option) })
    .click();
  await poppersClosed(page);
}

/** Cascader: click each level of the path in the open popper. */
async function pickCascader(page: Page, scope: Locator, label: string, pathLabels: string[]): Promise<void> {
  await item(scope, label).locator('.el-cascader').click();
  for (const step of pathLabels) {
    await page
      .locator('.el-cascader__dropdown:visible .el-cascader-node')
      .filter({ has: page.locator('.el-cascader-node__label', { hasText: exact(step) }) })
      .click();
  }
  await poppersClosed(page);
}

/** Month picker: type the value into the editor input and confirm with Enter. */
async function typeDate(page: Page, scope: Locator, label: string, value: string): Promise<void> {
  const input = item(scope, label).locator('input');
  await input.click();
  await input.fill(value);
  await input.press('Enter');
  await poppersClosed(page);
}

test.describe('Element Plus fixture (zh-CN)', () => {
  const { meta, state: expected } = loadExpected('element');
  const e = expected as Record<string, string | boolean | string[]>;
  const s = (k: string) => e[k] as string;
  const list = (k: string) => e[k] as string[];

  test('initial __fixtureState is all-empty with 2 education / 0 internship / 1 project cards', async ({ page }) => {
    await page.goto('/element/');
    await expect(page.locator('.el-form')).toBeVisible();
    const initial = await fixtureState(page);

    const expectedInitialKeys = Object.keys(expected).filter((k) => !k.startsWith('internship['));
    expect(Object.keys(initial).sort()).toEqual(expectedInitialKeys.sort());
    for (const [k, v] of Object.entries(initial)) expect(v, k).toEqual(emptyLike(expected[k]));
    await expect(page.getByText(/^教育经历 \d$/)).toHaveCount(2);
    await expect(page.getByText(/^实习经历 \d$/)).toHaveCount(0);
    await expect(page.getByText(/^项目经历 \d$/)).toHaveCount(1);
    expect(meta.__review).toEqual([]);
  });

  test('"添加实习经历" appends a card', async ({ page }) => {
    await page.goto('/element/');
    await page.getByRole('button', { name: '添加实习经历', exact: true }).click();
    await expect(page.getByText(/^实习经历 1$/)).toBeVisible();
    await page.getByRole('button', { name: '添加实习经历', exact: true }).click();
    await expect(page.getByText(/^实习经历 2$/)).toBeVisible();
    const state = await fixtureState(page);
    for (const k of ['company', 'position', 'startDate', 'endDate', 'current', 'description']) {
      expect(state).toHaveProperty([`internship[1].${k}`]);
    }
  });

  test('学校 select is remote: no options until a search, filtered after 300 ms', async ({ page }) => {
    await page.goto('/element/');
    const card = entry(page, '教育经历 1');
    const field = item(card, '学校');
    await field.locator('.el-select').click();
    await expect(page.locator('.el-select__popper:visible .el-select-dropdown__item')).toHaveCount(0);
    await field.getByRole('combobox').fill('浙江');
    const options = page.locator('.el-select__popper:visible .el-select-dropdown__item');
    await expect(options).toHaveText(['浙江大学', '浙江工业大学']);
  });

  test('filling the form with Playwright reproduces expected.json', async ({ page }) => {
    await page.goto('/element/');
    await expect(page.locator('.el-form')).toBeVisible();

    // 基本信息
    const basics = section(page, '基本信息');
    await item(basics, '姓名').locator('input').fill(s('name'));
    await item(basics, '性别').locator('label.el-radio').filter({ hasText: exact(s('gender')) }).click();
    await typeDate(page, basics, '出生年月', s('birthMonth'));
    await pickSelect(page, basics, '政治面貌', s('politicalStatus'));
    await pickSelect(page, basics, '婚姻状况', s('maritalStatus'));
    await item(basics, '手机').locator('input').fill(s('phone'));
    await item(basics, '邮箱').locator('input').fill(s('email'));
    await pickCascader(page, basics, '户口所在地', list('household'));
    await pickCascader(page, basics, '生源地', list('studentOrigin'));

    // 教育经历: two cards preset, school is a remote select (type, wait 300 ms, pick).
    for (let i = 0; i < 2; i++) {
      const card = entry(page, `教育经历 ${i + 1}`);
      await pickSelect(page, card, '学校', s(`education[${i}].school`), true);
      await pickSelect(page, card, '学历', s(`education[${i}].degree`));
      await pickSelect(page, card, '学位', s(`education[${i}].academicDegree`));
      await item(card, '专业').locator('input').fill(s(`education[${i}].major`));
      await typeDate(page, card, '开始时间', s(`education[${i}].startDate`));
      await typeDate(page, card, '结束时间', s(`education[${i}].endDate`));
    }

    // 实习经历: starts with 0 cards, each card needs the add button.
    for (let i = 0; i < 2; i++) {
      await page.getByRole('button', { name: '添加实习经历', exact: true }).click();
      const card = entry(page, `实习经历 ${i + 1}`);
      await item(card, '公司').locator('input').fill(s(`internship[${i}].company`));
      await item(card, '岗位').locator('input').fill(s(`internship[${i}].position`));
      await typeDate(page, card, '开始时间', s(`internship[${i}].startDate`));
      if (s(`internship[${i}].endDate`)) await typeDate(page, card, '结束时间', s(`internship[${i}].endDate`));
      if (e[`internship[${i}].current`]) await item(card, '是否在职').locator('label.el-checkbox').click();
      await item(card, '工作描述').locator('textarea').fill(s(`internship[${i}].description`));
    }

    // 项目经历: single card, no add button; only the first project is filled.
    const project = entry(page, '项目经历 1');
    await item(project, '项目名称').locator('input').fill(s('project[0].name'));
    await item(project, '担任角色').locator('input').fill(s('project[0].role'));
    await item(project, '项目描述').locator('textarea').fill(s('project[0].description'));

    // 家庭成员: plain table, header cells only, inputs addressed by row/column.
    const rows = section(page, '家庭成员').locator('tbody tr');
    for (let i = 0; i < 2; i++) {
      const inputs = rows.nth(i).locator('input');
      await inputs.nth(0).fill(s(`family[${i}].relationship`));
      await inputs.nth(1).fill(s(`family[${i}].name`));
      await inputs.nth(2).fill(s(`family[${i}].employer`));
      await inputs.nth(3).fill(s(`family[${i}].position`));
    }

    // 紧急联系人
    const emergency = section(page, '紧急联系人');
    await item(emergency, '姓名').locator('input').fill(s('emergencyContact.name'));
    await item(emergency, '电话').locator('input').fill(s('emergencyContact.phone'));

    // 其他信息
    const other = section(page, '其他信息');
    if (e.acceptRelocation) await item(other, '是否接受外派').locator('label.el-checkbox').click();
    await item(other, '照片')
      .locator('input[type="file"]')
      .setInputFiles({ name: list('photo')[0]!, mimeType: 'image/png', buffer: Buffer.from('fixture-photo') });
    await expect(page.locator('.el-upload-list__item-name')).toHaveText(list('photo')[0]!);
    await item(other, '自我介绍').locator('textarea').fill(s('selfIntroduction'));

    expect(await fixtureState(page)).toEqual(expected);
  });
});
