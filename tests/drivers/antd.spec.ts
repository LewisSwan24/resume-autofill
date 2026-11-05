import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';
import type { FieldReport } from '../../src/engine/types';
import { execIntent, fixtureState, injectHarness, findControlByLabel, type IntentJson } from './helpers';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const raw = JSON.parse(readFileSync(path.join(ROOT, 'fixtures', 'synthetic', 'antd', 'expected.json'), 'utf8')) as Record<
  string,
  unknown
>;
const expected = Object.fromEntries(Object.entries(raw).filter(([k]) => !k.startsWith('__'))) as Record<string, unknown>;

const PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 fixture').toString('base64')}`;

let page: Page;

test.beforeEach(async ({ page: p }) => {
  page = p;
  await page.goto('/antd/');
  await page.getByLabel('姓名', { exact: true }).waitFor();
  await injectHarness(page);
});

const choice = (value: string): IntentJson => ({ kind: 'choice', display: value, query: value });
const month = (y: number, m: number): IntentJson => ({
  kind: 'date',
  display: `${y}-${String(m).padStart(2, '0')}`,
  year: y,
  month: m,
});

/** No popup may stay open (or mid leave-animation) once a driver returns. */
async function expectPopupsClosed(): Promise<void> {
  await expect(page.locator('.ant-select-dropdown:visible, .ant-picker-dropdown:visible')).toHaveCount(0);
}

/** Run the antd driver directly with a chosen attempt number (executeStep only reaches attempt 2 after a failure). */
function fillAttempt(label: string, intent: IntentJson, attempt: 1 | 2, nth?: number) {
  return page.evaluate(
    async ([l, i, a, n]) => {
      const found = window.__raf.locate(l, n === undefined ? {} : { nth: n });
      const control = window.__raf.discover(document).find((c) => c.id === found.id)!;
      const driver = window.__raf.getDriver(control)!;
      const result = await driver.fill(control, window.__raf.buildIntent(i), { doc: document, attempt: a, timeoutMs: 4000 });
      return { driver: driver.id, result, observed: driver.read(control) };
    },
    [label, intent, attempt, nth] as const,
  );
}

test.describe('antd drivers on the antd fixture', () => {
  test('discover maps the antd widgets onto the antd drivers', async () => {
    const drivers = await page.evaluate(() =>
      window.__raf.discover(document).map((c) => `${c.kind}:${c.lib}:${window.__raf.getDriver(c)?.id}`),
    );
    expect(new Set(drivers)).toEqual(
      new Set([
        'text:native:native',
        'textarea:native:native',
        'radio:antd:native',
        'checkbox:native:native',
        'date:antd:antd-date',
        'select:antd:antd-select',
        'cascader:antd:antd-cascader',
        'file:antd:antd-upload',
      ]),
    );
  });

  test('select (single, not searchable)', async () => {
    const report = await execIntent(page, '政治面貌', choice('共青团员'));
    expect(report).toMatchObject({ outcome: 'filled', observed: '共青团员' });
    expect((await fixtureState(page)).politicalStatus).toBe('共青团员');
    await expectPopupsClosed();
  });

  test('select (single, showSearch) and back-to-back selects stay scoped to their own popup', async () => {
    const a = await execIntent(page, '民族', choice('回族'));
    // No waiting for the leave animation here: the next select opens while the previous popup is still fading.
    const b = await execIntent(page, '政治面貌', choice('群众'));
    const c = await execIntent(page, '学历', choice('硕士研究生'));
    expect(a).toMatchObject({ outcome: 'filled', observed: '回族' });
    expect(b).toMatchObject({ outcome: 'filled', observed: '群众' });
    expect(c).toMatchObject({ outcome: 'filled', observed: '硕士研究生' });
    const state = await fixtureState(page);
    expect(state.ethnicity).toBe('回族');
    expect(state.politicalStatus).toBe('群众');
    expect(state['education[0].degree']).toBe('硕士研究生');
    await expectPopupsClosed();
  });

  test('showSearch select: the option is found by typing when the matcher saw nothing in the rendered list', async () => {
    // The matcher below only accepts a label that is never rendered before a search is typed.
    const report = await page.evaluate(async () => {
      const found = window.__raf.locate('学校名称');
      const control = window.__raf.discover(document).find((c) => c.id === found.id)!;
      let calls = 0;
      return window.__raf.executeStep(
        {
          fieldId: found.id,
          fieldKey: 'test.field',
          confidence: 1,
          label: found.label,
          intent: {
            kind: 'choice',
            display: '昆士兰大学',
            query: '昆士兰',
            match: (options) => {
              calls++;
              // First call sees the whole list; pretend nothing matches until the list is filtered by the query.
              if (options.length > 1) return { status: 'none' };
              const i = options.findIndex((o) => o.label === '昆士兰大学');
              return i >= 0 ? { status: 'matched', index: i, confidence: 1 } : { status: 'none' };
            },
          },
        },
        control,
        document,
      ).then((r) => ({ ...r, calls }));
    });
    expect(report).toMatchObject({ outcome: 'filled', observed: '昆士兰大学' });
    expect(report.calls).toBeGreaterThan(1);
    expect((await fixtureState(page))['education[0].school']).toBe('昆士兰大学');
    await expectPopupsClosed();
  });

  test('select: the country-code select inside the phone addon is its own control', async () => {
    const labels = await page.evaluate(() => window.__raf.listLabels());
    const addon = labels.find((l) => l.includes(':select:') && /区号/.test(l));
    expect(addon, labels.join('\n')).toBeTruthy();
    const report = await execIntent(page, '区号', choice('+61'));
    expect(report).toMatchObject({ outcome: 'filled', observed: '+61' });
    const state = await fixtureState(page);
    expect(state.phoneCountryCode).toBe('+61');
    expect(state.phone).toBe('');
  });

  test('multiple select: 期望城市 [深圳, 杭州]', async () => {
    const report = await execIntent(page, '期望城市', {
      kind: 'multi',
      display: '深圳, 杭州',
      items: [{ query: '深圳' }, { query: '杭州' }],
    });
    expect(report).toMatchObject({ outcome: 'filled', observed: '深圳, 杭州' });
    expect((await fixtureState(page)).expectedCities).toEqual(['深圳', '杭州']);
    await expectPopupsClosed();
  });

  test('multiple select is an exact set: a second fill replaces the first, repeats do not toggle', async () => {
    const first = await execIntent(page, '期望城市', {
      kind: 'multi',
      display: '北京, 上海',
      items: [{ query: '北京' }, { query: '上海' }],
    });
    expect(first.outcome).toBe('filled');
    const second = await execIntent(page, '期望城市', {
      kind: 'multi',
      display: '上海, 广州',
      items: [{ query: '上海' }, { query: '广州' }],
    });
    expect(second).toMatchObject({ outcome: 'filled', observed: '上海, 广州' });
    expect((await fixtureState(page)).expectedCities).toEqual(['上海', '广州']);
    await expectPopupsClosed();
  });

  test('multiple select: one missing value → no_option and nothing is selected', async () => {
    const report = await execIntent(page, '期望城市', {
      kind: 'multi',
      display: '深圳, 成都',
      items: [{ query: '深圳' }, { query: '成都' }],
    });
    expect(report.outcome).toBe('no_option');
    expect((await fixtureState(page)).expectedCities).toEqual([]);
    await expectPopupsClosed();
  });

  test('negative: 外语语种 has no 英语 → no_option, state unchanged, dropdown closed', async () => {
    const before = await fixtureState(page);
    const report = await execIntent(page, '外语语种', choice('英语'));
    expect(report.outcome).toBe('no_option');
    expect(report.observed ?? null).toBeNull();
    expect(await fixtureState(page)).toEqual(before);
    expect(before.foreignLanguage).toBe('');
    await expectPopupsClosed();
  });

  test('ambiguous match → needs_review with candidates, nothing picked', async () => {
    const report: FieldReport = await page.evaluate(async () => {
      const found = window.__raf.locate('学历');
      const control = window.__raf.discover(document).find((c) => c.id === found.id)!;
      return window.__raf.executeStep(
        {
          fieldId: found.id,
          fieldKey: 'test.field',
          confidence: 1,
          label: found.label,
          intent: {
            kind: 'choice',
            display: '研究生',
            query: '研究生',
            match: () => ({ status: 'ambiguous', candidates: [2, 3] }),
          },
        },
        control,
        document,
      );
    });
    expect(report.outcome).toBe('needs_review');
    expect(report.candidates?.map((c) => c.label)).toEqual(['硕士研究生', '博士研究生']);
    expect((await fixtureState(page))['education[0].degree']).toBe('');
    await expectPopupsClosed();
  });

  test('cascader: 籍贯 (2 levels)', async () => {
    const report = await execIntent(page, '籍贯', { kind: 'cascade', display: '浙江省/杭州市', path: ['浙江省', '杭州市'] });
    expect(report).toMatchObject({ outcome: 'filled', observed: '浙江省 / 杭州市' });
    expect((await fixtureState(page)).nativePlace).toEqual(['浙江省', '杭州市']);
    await expectPopupsClosed();
  });

  test('cascader: 现居住地 (3 levels)', async () => {
    const report = await execIntent(page, '现居住地', {
      kind: 'cascade',
      display: '广东省/深圳市/南山区',
      path: ['广东省', '深圳市', '南山区'],
    });
    expect(report).toMatchObject({ outcome: 'filled', observed: '广东省 / 深圳市 / 南山区' });
    expect((await fixtureState(page)).currentLocation).toEqual(['广东省', '深圳市', '南山区']);
    await expectPopupsClosed();
  });

  test('cascader: a path longer than the tree ends at the leaf (district given for a province/city list)', async () => {
    const report = await execIntent(page, '籍贯', {
      kind: 'cascade',
      display: '浙江省/杭州市/西湖区',
      path: ['浙江省', '杭州市', '西湖区'],
    });
    expect(report).toMatchObject({ outcome: 'filled', observed: '浙江省 / 杭州市' });
    expect((await fixtureState(page)).nativePlace).toEqual(['浙江省', '杭州市']);
    await expectPopupsClosed();
  });

  test('cascader: unknown province → no_option, nothing committed, popup closed', async () => {
    const report = await execIntent(page, '籍贯', { kind: 'cascade', display: '四川省/成都市', path: ['四川省', '成都市'] });
    expect(report.outcome).toBe('no_option');
    expect((await fixtureState(page)).nativePlace).toEqual([]);
    await expectPopupsClosed();
  });

  test('cascader: unknown city under a known province → no_option, nothing committed', async () => {
    const report = await execIntent(page, '籍贯', { kind: 'cascade', display: '浙江省/温州市', path: ['浙江省', '温州市'] });
    expect(report.outcome).toBe('no_option');
    expect((await fixtureState(page)).nativePlace).toEqual([]);
    await expectPopupsClosed();
  });

  test('date picker (month): type + Enter', async () => {
    const report = await execIntent(page, '入学时间', month(2020, 9));
    expect(report).toMatchObject({ outcome: 'filled', observed: '2020-09' });
    expect((await fixtureState(page))['education[0].startDate']).toBe('2020-09');
    await expectPopupsClosed();
  });

  test('date picker (day): type + Enter', async () => {
    const report = await execIntent(page, '出生日期', {
      kind: 'date',
      display: '2002-03-15',
      year: 2002,
      month: 3,
      day: 15,
    });
    expect(report).toMatchObject({ outcome: 'filled', observed: '2002-03-15' });
    expect((await fixtureState(page)).birthDate).toBe('2002-03-15');
    await expectPopupsClosed();
  });

  const span = (): IntentJson => ({
    kind: 'dateRange',
    display: '2022-03 ~ 2022-06',
    start: { display: '2022-03', year: 2022, month: 3 },
    end: { display: '2022-06', year: 2022, month: 6 },
  });

  test('range picker: types both ends, and reads both back', async () => {
    const d = await fillAttempt('起止时间', span(), 1);
    expect(d.result.ok, JSON.stringify(d.result)).toBe(true);
    expect((await fixtureState(page))['project[0].period']).toBe('2022-03 ~ 2022-06');
    expect(d.observed).toBe('2022-03 ~ 2022-06');
    await expectPopupsClosed();
  });

  test('range picker: goes through the panel on the second attempt', async () => {
    const d = await fillAttempt('起止时间', span(), 2);
    expect(d.result.ok, JSON.stringify(d.result)).toBe(true);
    expect((await fixtureState(page))['project[0].period']).toBe('2022-03 ~ 2022-06');
    await expectPopupsClosed();
  });

  test('range picker: a year away on the panel too', async () => {
    const far: IntentJson = { kind: 'dateRange', display: '2015-09 ~ 2019-06', start: { display: '2015-09', year: 2015, month: 9 }, end: { display: '2019-06', year: 2019, month: 6 } };
    const d = await fillAttempt('起止时间', far, 2);
    expect(d.result.ok, JSON.stringify(d.result)).toBe(true);
    expect((await fixtureState(page))['project[0].period']).toBe('2015-09 ~ 2019-06');
    await expectPopupsClosed();
  });

  test('attempt 1 commits typed dates on its own (no fallback to the panel)', async () => {
    const m = await fillAttempt('入学时间', month(2020, 9), 1);
    expect(m.result.ok, JSON.stringify(m.result)).toBe(true);
    const d = await fillAttempt('出生日期', { kind: 'date', display: '2002-03-15', year: 2002, month: 3, day: 15 }, 1);
    expect(d.result.ok, JSON.stringify(d.result)).toBe(true);
    const state = await fixtureState(page);
    expect(state['education[0].startDate']).toBe('2020-09');
    expect(state.birthDate).toBe('2002-03-15');
  });

  test('select attempt 2 opens with the keyboard instead of a click', async () => {
    const r = await fillAttempt('政治面貌', choice('中共党员'), 2);
    expect(r.result.ok, JSON.stringify(r.result)).toBe(true);
    expect((await fixtureState(page)).politicalStatus).toBe('中共党员');
    await expectPopupsClosed();
  });

  test('date picker (month): attempt 2 navigates the panel', async () => {
    const { driver, result, observed } = await fillAttempt('入学时间', month(2020, 9), 2);
    expect(driver).toBe('antd-date');
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(observed).toBe('2020-09');
    expect((await fixtureState(page))['education[0].startDate']).toBe('2020-09');
    await expectPopupsClosed();
  });

  test('date picker (month): panel navigation also works forward in time', async () => {
    const { result } = await fillAttempt('毕业时间', month(2027, 12), 2);
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect((await fixtureState(page))['education[0].endDate']).toBe('2027-12');
    await expectPopupsClosed();
  });

  test('date picker (day): attempt 2 navigates year, month and day', async () => {
    const { result, observed } = await fillAttempt(
      '出生日期',
      { kind: 'date', display: '1998-11-05', year: 1998, month: 11, day: 5 },
      2,
    );
    expect(result.ok, JSON.stringify(result)).toBe(true);
    expect(observed).toBe('1998-11-05');
    expect((await fixtureState(page)).birthDate).toBe('1998-11-05');
    await expectPopupsClosed();
  });

  test('date picker overwrites an existing value', async () => {
    await execIntent(page, '入学时间', month(2020, 9));
    const report = await execIntent(page, '入学时间', month(2021, 2));
    expect(report).toMatchObject({ outcome: 'filled', observed: '2021-02' });
    expect((await fixtureState(page))['education[0].startDate']).toBe('2021-02');
  });

  test('radio group (native driver on Radio.Group)', async () => {
    const report = await execIntent(page, '性别', choice('男'));
    expect(report).toMatchObject({ outcome: 'filled', observed: '男' });
    expect((await fixtureState(page)).gender).toBe('男');
    const other = await execIntent(page, '是否服从调剂', choice('否'));
    expect(other).toMatchObject({ outcome: 'filled', observed: '否' });
    expect((await fixtureState(page)).acceptAdjustment).toBe('否');
  });

  test('radio group: no matching option → no_option', async () => {
    const report = await execIntent(page, '性别', choice('其他'));
    expect(report.outcome).toBe('no_option');
    expect((await fixtureState(page)).gender).toBe('');
  });

  test('single checkbox 至今 (native driver): check, then uncheck', async () => {
    const on = await execIntent(page, '至今', { kind: 'check', checked: true }, { nth: 0 });
    expect(on).toMatchObject({ outcome: 'filled', observed: 'true' });
    expect((await fixtureState(page))['internship[0].current']).toBe(true);
    const off = await execIntent(page, '至今', { kind: 'check', checked: false }, { nth: 0 });
    expect(off).toMatchObject({ outcome: 'filled', observed: 'false' });
    expect((await fixtureState(page))['internship[0].current']).toBe(false);
  });

  test('upload: injects the file and antd lists it', async () => {
    const report = await execIntent(page, '上传简历', {
      kind: 'file',
      file: { name: '林知远-简历.pdf', type: 'application/pdf', dataUrl: PDF_DATA_URL },
    });
    expect(report).toMatchObject({ outcome: 'filled', observed: '林知远-简历.pdf' });
    expect((await fixtureState(page)).resume).toEqual(['林知远-简历.pdf']);
    await expect(page.locator('.ant-upload-list-item-name')).toHaveText('林知远-简历.pdf');
  });

  test('the whole form can be filled through the drivers and equals expected.json', async () => {
    const e = expected as Record<string, string | boolean | string[]>;
    const s = (k: string): string => e[k] as string;
    const list = (k: string): string[] => e[k] as string[];
    const run = async (label: string, intent: IntentJson, nth?: number): Promise<void> => {
      const report = await execIntent(page, label, intent, nth === undefined ? {} : { nth });
      expect(report.outcome, `${label}[${nth ?? ''}] ${JSON.stringify(report)}`).toBe('filled');
    };
    const text = (label: string, value: string, nth?: number) => run(label, { kind: 'text', text: value }, nth);
    const dateOf = (v: string): IntentJson => {
      const [y, m, d] = v.split('-').map(Number) as [number, number, number | undefined];
      return d === undefined ? { kind: 'date', display: v, year: y, month: m } : { kind: 'date', display: v, year: y, month: m, day: d };
    };

    await text('姓名', s('name'));
    await run('性别', choice(s('gender')));
    await run('出生日期', dateOf(s('birthDate')));
    await run('民族', choice(s('ethnicity')));
    await run('政治面貌', choice(s('politicalStatus')));
    await run('区号', choice(s('phoneCountryCode')));
    // Once the country code is set its placeholder is gone, but the dial code it shows keeps it labelled 区号.
    await text('手机号码', s('phone'));
    await text('电子邮箱', s('email'));
    await text('身份证号', s('idNumber'));
    await text('微信号', s('wechat'));
    await run('籍贯', { kind: 'cascade', display: list('nativePlace').join('/'), path: list('nativePlace') });
    await run('现居住地', { kind: 'cascade', display: list('currentLocation').join('/'), path: list('currentLocation') });
    await text('期望职位', s('expectedPosition'));
    await run('期望城市', {
      kind: 'multi',
      display: list('expectedCities').join(', '),
      items: list('expectedCities').map((query) => ({ query })),
    });
    await run('是否服从调剂', choice(s('acceptAdjustment')));

    await page.getByRole('button', { name: '+ 添加教育经历' }).click();
    for (let i = 0; i < 2; i++) {
      await run('学校名称', choice(s(`education[${i}].school`)), i);
      await run('学历', choice(s(`education[${i}].degree`)), i);
      await text('专业', s(`education[${i}].major`), i);
      await run('入学时间', dateOf(s(`education[${i}].startDate`)), i);
      await run('毕业时间', dateOf(s(`education[${i}].endDate`)), i);
      if (s(`education[${i}].gpa`)) await text('GPA', s(`education[${i}].gpa`), i);
      if (s(`education[${i}].ranking`)) await text('专业排名', s(`education[${i}].ranking`), i);
    }
    for (let i = 0; i < 2; i++) {
      await text('公司名称', s(`internship[${i}].company`), i);
      await text('职位名称', s(`internship[${i}].position`), i);
      await run('开始时间', dateOf(s(`internship[${i}].startDate`)), i);
      if (s(`internship[${i}].endDate`)) await run('结束时间', dateOf(s(`internship[${i}].endDate`)), i);
      if (e[`internship[${i}].current`]) await run('至今', { kind: 'check', checked: true }, i);
      await text('工作内容', s(`internship[${i}].description`), i);
    }
    await run('英语等级', choice(s('englishLevel')));
    await text('项目名称', s('project[0].name'));
    await run('起止时间', span());
    await text('奖项名称', s('award[0].name'));
    await run('获奖时间', dateOf(s('award[0].date')));
    await run('奖项级别', choice(s('award[0].level')));
    await run('上传简历', {
      kind: 'file',
      file: { name: list('resume')[0]!, type: 'application/pdf', dataUrl: PDF_DATA_URL },
    });
    await text('自我评价', s('selfEvaluation'));

    expect(await fixtureState(page)).toEqual(expected);
    await expectPopupsClosed();
  });
});

test('findControlByLabel resolves antd widgets to their kinds', async () => {
  const kinds = await Promise.all(
    ['政治面貌', '籍贯', '出生日期', '性别', '上传简历'].map(async (l) => (await findControlByLabel(page, l)).kind),
  );
  expect(kinds).toEqual(['select', 'cascader', 'date', 'radio', 'file']);
});

