import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test, type Page } from '@playwright/test';
import type { FieldReport } from '../../src/engine/types';
import { execIntent, fixtureState, injectHarness, findControlByLabel, type IntentJson } from './helpers';

// 1x1 transparent PNG.
const PNG_DATA_URL =
  'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

let page: Page;

/** Element Plus keeps closed poppers in the DOM; only displayed ones count as "open". */
const noPopperOpen = () => expect(page.locator('.el-popper:visible')).toHaveCount(0);

const choice = (value: string, query = value): IntentJson => ({ kind: 'choice', display: value, query });
const month = (y: number, m: number): IntentJson => ({
  kind: 'date',
  display: `${y}-${String(m).padStart(2, '0')}`,
  year: y,
  month: m,
});

/**
 * Run the driver pipeline with a custom option matcher (the JSON intents only describe exact label
 * matchers): every option whose label contains `needle` counts, so several hits are ambiguous.
 */
function runContains(label: string, needle: string, nth?: number): Promise<FieldReport> {
  return page.evaluate(
    ([l, n, i]) => {
      const raf = window.__raf;
      const found = raf.locate(l, i === undefined ? {} : { nth: i });
      const control = raf.discover(document).find((c) => c.id === found.id)!;
      return raf.executeStep(
        {
          fieldId: found.id,
          fieldKey: 'test.field',
          confidence: 1,
          label: found.label,
          intent: {
            kind: 'choice',
            display: n,
            query: n,
            match: (options) => {
              const hits = options.flatMap((o, k) => (o.label.includes(n) ? [k] : []));
              if (hits.length === 0) return { status: 'none' };
              if (hits.length > 1) return { status: 'ambiguous', candidates: hits };
              return { status: 'matched', index: hits[0]!, confidence: 0.8 };
            },
          },
        },
        control,
        document,
      );
    },
    [label, needle, nth] as const,
  );
}

/** Call the driver directly for one attempt (the executor only reaches attempt 2 after a failure). */
function runAttempt(label: string, attempt: 1 | 2, intent: IntentJson, nth?: number) {
  return page.evaluate(
    ([l, a, it, i]) => {
      const raf = window.__raf;
      const found = raf.locate(l, i === undefined ? {} : { nth: i });
      const control = raf.discover(document).find((c) => c.id === found.id)!;
      const driver = raf.getDriver(control)!;
      return driver
        .fill(control, raf.buildIntent(it), { doc: document, attempt: a, timeoutMs: 4000 })
        .then((result) => ({ driver: driver.id, result, observed: driver.read(control) }));
    },
    [label, attempt, intent, nth] as const,
  );
}

test.describe('Element Plus drivers on the Element fixture', () => {
  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('/element/');
    await page.waitForSelector('.el-form');
    await injectHarness(page);
  });

  test('discover reports library controls with the expected kinds', async () => {
    expect(await findControlByLabel(page, '婚姻状况')).toMatchObject({ kind: 'select', lib: 'element' });
    expect(await findControlByLabel(page, '户口所在地')).toMatchObject({ kind: 'cascader', lib: 'element' });
    expect(await findControlByLabel(page, '出生年月')).toMatchObject({ kind: 'date', lib: 'element' });
    expect(await findControlByLabel(page, '照片')).toMatchObject({ kind: 'file', lib: 'element' });
    expect(await findControlByLabel(page, '性别')).toMatchObject({ kind: 'radio', lib: 'element' });
  });

  test.describe('el-select', () => {
    test('single select: 婚姻状况', async () => {
      const report = await execIntent(page, '婚姻状况', choice('已婚'));
      expect(report).toMatchObject({ outcome: 'filled', observed: '已婚' });
      expect((await fixtureState(page)).maritalStatus).toBe('已婚');
      await noPopperOpen();
    });

    test('two selects in a row (scoped by aria-controls, no waiting for the leave animation)', async () => {
      const a = await execIntent(page, '政治面貌', choice('共青团员'));
      const b = await execIntent(page, '婚姻状况', choice('未婚'));
      expect(a).toMatchObject({ outcome: 'filled', observed: '共青团员' });
      expect(b).toMatchObject({ outcome: 'filled', observed: '未婚' });
      const state = await fixtureState(page);
      expect(state).toMatchObject({ politicalStatus: '共青团员', maritalStatus: '未婚' });
    });

    test('select inside education card 2 (学历)', async () => {
      const report = await execIntent(page, '学历', choice('硕士研究生'), { nth: 1 });
      expect(report).toMatchObject({ outcome: 'filled', observed: '硕士研究生' });
      const state = await fixtureState(page);
      expect(state['education[1].degree']).toBe('硕士研究生');
      expect(state['education[0].degree']).toBe('');
    });

    test('remote filterable select: 学校 in education card 2 (昆士兰大学)', async () => {
      const before = await fixtureState(page);
      expect(before['education[1].school']).toBe('');
      const report = await execIntent(page, '学校', choice('昆士兰大学'), { nth: 1 });
      expect(report).toMatchObject({ outcome: 'filled', observed: '昆士兰大学' });
      const state = await fixtureState(page);
      expect(state['education[1].school']).toBe('昆士兰大学');
      expect(state['education[0].school']).toBe('');
      await noPopperOpen();
    });

    test('remote select: short query, exact label chosen among several results', async () => {
      const report = await execIntent(page, '学校', { kind: 'choice', display: '浙江大学', query: '浙江', options: { matchLabel: '浙江大学' } }, { nth: 0 });
      expect(report).toMatchObject({ outcome: 'filled', observed: '浙江大学' });
      expect((await fixtureState(page))['education[0].school']).toBe('浙江大学');
    });

    test('remote select: ambiguous results → needs_review, nothing picked, popper closed', async () => {
      const report = await runContains('学校', '浙江', 0);
      expect(report.outcome).toBe('needs_review');
      expect(report.candidates?.map((c) => c.label)).toEqual(['浙江大学', '浙江工业大学']);
      expect((await fixtureState(page))['education[0].school']).toBe('');
      await noPopperOpen();
    });

    test('remote select: nothing found → no_option, state unchanged, popper closed', async () => {
      const report = await execIntent(page, '学校', choice('University of Hobart'), { nth: 0 });
      expect(report.outcome).toBe('no_option');
      expect(report.observed ?? null).toBeNull();
      expect((await fixtureState(page))['education[0].school']).toBe('');
      await noPopperOpen();
    });

    test('remote select: results exist but none is the wanted label → no_option, nothing picked', async () => {
      const report = await execIntent(page, '学校', { kind: 'choice', display: '清华大学', query: '浙江', options: { matchLabel: '清华大学' } }, { nth: 0 });
      expect(report.outcome).toBe('no_option');
      expect((await fixtureState(page))['education[0].school']).toBe('');
      await noPopperOpen();
    });

    test('static select: no matching option → no_option (never picks), popper closed', async () => {
      const before = await fixtureState(page);
      const report = await execIntent(page, '政治面貌', choice('民主党派'));
      expect(report.outcome).toBe('no_option');
      expect(report.observed ?? null).toBeNull();
      expect(await fixtureState(page)).toEqual(before);
      await noPopperOpen();
    });

    test('static select: ambiguous options → needs_review', async () => {
      const report = await runContains('政治面貌', '中共');
      expect(report.outcome).toBe('needs_review');
      expect(report.candidates?.map((c) => c.label)).toEqual(['中共党员', '中共预备党员']);
      expect((await fixtureState(page)).politicalStatus).toBe('');
      await noPopperOpen();
    });
  });

  test.describe('el-cascader', () => {
    test('户口所在地: province / city / district', async () => {
      const report = await execIntent(page, '户口所在地', { kind: 'cascade', display: '浙江省/杭州市/西湖区', path: ['浙江省', '杭州市', '西湖区'] });
      expect(report).toMatchObject({ outcome: 'filled', observed: '浙江省 / 杭州市 / 西湖区' });
      const state = await fixtureState(page);
      expect(state.household).toEqual(['浙江省', '杭州市', '西湖区']);
      expect(state.studentOrigin).toEqual([]);
      await noPopperOpen();
    });

    test('生源地: names without the 省/市/区 suffix still match uniquely', async () => {
      const report = await execIntent(page, '生源地', { kind: 'cascade', display: '广东/深圳/南山', path: ['广东', '深圳', '南山'] });
      expect(report).toMatchObject({ outcome: 'filled', observed: '广东省 / 深圳市 / 南山区' });
      expect((await fixtureState(page)).studentOrigin).toEqual(['广东省', '深圳市', '南山区']);
    });

    test('municipality whose second level repeats the first', async () => {
      const report = await execIntent(page, '户口所在地', { kind: 'cascade', display: '北京市/北京市/朝阳区', path: ['北京市', '北京市', '朝阳区'] });
      expect(report.outcome).toBe('filled');
      expect((await fixtureState(page)).household).toEqual(['北京市', '北京市', '朝阳区']);
    });

    test('unknown level → no_option, nothing committed, popper closed', async () => {
      const report = await execIntent(page, '户口所在地', { kind: 'cascade', display: '浙江省/温州市', path: ['浙江省', '温州市', '鹿城区'] });
      expect(report.outcome).toBe('no_option');
      expect((await fixtureState(page)).household).toEqual([]);
      await noPopperOpen();
    });

    test('path stopping above a leaf is not committed', async () => {
      const report = await execIntent(page, '户口所在地', { kind: 'cascade', display: '浙江省/杭州市', path: ['浙江省', '杭州市'] });
      expect(report.outcome).toBe('no_option');
      expect((await fixtureState(page)).household).toEqual([]);
      await noPopperOpen();
    });
  });

  test.describe('el-date-picker (month)', () => {
    test('attempt 1: type YYYY-MM + Enter (出生年月)', async () => {
      const report = await execIntent(page, '出生年月', month(2002, 3));
      expect(report).toMatchObject({ outcome: 'filled', observed: '2002-03' });
      expect((await fixtureState(page)).birthMonth).toBe('2002-03');
      await noPopperOpen();
    });

    test('month picker inside education card 2 (开始时间)', async () => {
      const report = await execIntent(page, '开始时间', month(2024, 7), { nth: 1 });
      expect(report).toMatchObject({ outcome: 'filled', observed: '2024-07' });
      const state = await fixtureState(page);
      expect(state['education[1].startDate']).toBe('2024-07');
      expect(state['education[0].startDate']).toBe('');
    });

    test('attempt 2: panel navigation across years (2002 from the 2026 panel)', async () => {
      const { driver, result, observed } = await runAttempt('出生年月', 2, month(2002, 3));
      expect(driver).toBe('element-date');
      expect(result).toMatchObject({ ok: true, observed: '2002-03' });
      expect(observed).toBe('2002-03');
      expect((await fixtureState(page)).birthMonth).toBe('2002-03');
      await noPopperOpen();
    });

    test('attempt 2: panel navigation forward in time (2029-12)', async () => {
      const { result } = await runAttempt('结束时间', 2, month(2029, 12), 0);
      expect(result).toMatchObject({ ok: true, observed: '2029-12' });
      expect((await fixtureState(page))['education[0].endDate']).toBe('2029-12');
    });
  });

  test.describe('date range', () => {
    const span: IntentJson = {
      kind: 'dateRange',
      display: '2022-03 ~ 2022-06',
      start: { display: '2022-03', year: 2022, month: 3 },
      end: { display: '2022-06', year: 2022, month: 6 },
    };

    test('types both ends, and reads both back', async () => {
      const report = await execIntent(page, '起止时间', span);
      expect(report.outcome, JSON.stringify(report)).toBe('filled');
      expect(report.observed).toBe('2022-03 ~ 2022-06');
      expect((await fixtureState(page))['project[0].period']).toBe('2022-03 ~ 2022-06');
      await expect(page.locator('.el-picker__popper:visible')).toHaveCount(0);
    });

    test('reports a span it will not take, and leaves nothing open', async () => {
      const report = await execIntent(page, '起止时间', { ...span, start: { display: 'x', year: 2022, month: 13 } });
      expect(report.outcome).not.toBe('filled');
      await expect(page.locator('.el-picker__popper:visible')).toHaveCount(0);
    });
  });

  test.describe('el-radio-group / el-checkbox (native driver)', () => {
    test('性别 radio', async () => {
      const report = await execIntent(page, '性别', choice('女'));
      expect(report).toMatchObject({ outcome: 'filled', observed: '女' });
      expect((await fixtureState(page)).gender).toBe('女');
      const again = await execIntent(page, '性别', choice('男'));
      expect(again).toMatchObject({ outcome: 'filled', observed: '男' });
      expect((await fixtureState(page)).gender).toBe('男');
    });

    test('性别 radio: unknown option → no_option', async () => {
      const report = await execIntent(page, '性别', choice('其他'));
      expect(report.outcome).toBe('no_option');
      expect((await fixtureState(page)).gender).toBe('');
    });

    test('single checkbox 是否接受外派', async () => {
      // The form-item label outranks the wrapped option label (是).
      const on = await execIntent(page, '是否接受外派', { kind: 'check', checked: true });
      expect(on).toMatchObject({ outcome: 'filled', observed: 'true' });
      expect((await fixtureState(page)).acceptRelocation).toBe(true);
      const off = await execIntent(page, '是否接受外派', { kind: 'check', checked: false });
      expect(off).toMatchObject({ outcome: 'filled', observed: 'false' });
      expect((await fixtureState(page)).acceptRelocation).toBe(false);
    });
  });

  test('el-upload: 照片', async () => {
    const report = await execIntent(page, '照片', {
      kind: 'file',
      file: { name: 'photo.png', type: 'image/png', dataUrl: PNG_DATA_URL },
    });
    expect(report).toMatchObject({ outcome: 'filled', observed: 'photo.png' });
    expect((await fixtureState(page)).photo).toEqual(['photo.png']);
    await expect(page.locator('.el-upload-list__item-name')).toHaveText(['photo.png']);
  });

  test('a mixed run of different widgets leaves every field filled and no popper open', async () => {
    const steps: [string, IntentJson, { nth?: number }?][] = [
      ['性别', choice('男')],
      ['出生年月', month(2002, 3)],
      ['政治面貌', choice('共青团员')],
      ['婚姻状况', choice('未婚')],
      ['户口所在地', { kind: 'cascade', display: '浙江省/杭州市/西湖区', path: ['浙江省', '杭州市', '西湖区'] }],
      ['学校', choice('浙江大学'), { nth: 0 }],
      ['学校', choice('昆士兰大学'), { nth: 1 }],
      ['学历', choice('本科'), { nth: 0 }],
      ['学历', choice('硕士研究生'), { nth: 1 }],
      ['学位', choice('硕士'), { nth: 1 }],
      ['开始时间', month(2024, 7), { nth: 1 }],
      ['结束时间', month(2026, 6), { nth: 1 }],
    ];
    for (const [label, intent, opts] of steps) {
      const report = await execIntent(page, label, intent, opts ?? {});
      expect(report.outcome, `${label} ${JSON.stringify(opts ?? {})}: ${JSON.stringify(report)}`).toBe('filled');
    }
    const state = await fixtureState(page);
    expect(state).toMatchObject({
      gender: '男',
      birthMonth: '2002-03',
      politicalStatus: '共青团员',
      maritalStatus: '未婚',
      household: ['浙江省', '杭州市', '西湖区'],
      'education[0].school': '浙江大学',
      'education[1].school': '昆士兰大学',
      'education[0].degree': '本科',
      'education[1].degree': '硕士研究生',
      'education[1].academicDegree': '硕士',
      'education[1].startDate': '2024-07',
      'education[1].endDate': '2026-06',
    });
    await noPopperOpen();
  });
});


// ---------------------------------------------------------------------------------------------------
// Widgets the Element fixture does not contain (day picker, multiple / local-filterable select), rendered
// from the real Element Plus 2.x full build in node_modules (English locale → also covers "Nov"-style labels).
// ---------------------------------------------------------------------------------------------------

const require = createRequire(import.meta.url);
const EP_DIR = path.dirname(require.resolve('element-plus/package.json'));
const VUE_GLOBAL = path.join(path.dirname(require.resolve('vue/package.json')), 'dist', 'vue.global.prod.js');

const EXTRA_HTML = `
<div id="app">
  <el-form label-width="120px">
    <el-form-item label="Start date"><el-date-picker v-model="date" type="date" value-format="YYYY-MM-DD" /></el-form-item>
    <el-form-item label="Skills">
      <el-select v-model="skills" multiple placeholder="Select">
        <el-option v-for="o in skillOptions" :key="o" :label="o" :value="o" />
      </el-select>
    </el-form-item>
    <el-form-item label="City">
      <el-select v-model="city" filterable placeholder="Pick a city">
        <el-option v-for="o in cities" :key="o" :label="o" :value="o" />
      </el-select>
    </el-form-item>
  </el-form>
</div>`;

const EXTRA_SCRIPT = `
const { createApp, reactive, toRefs } = Vue;
const state = reactive({ date: '', skills: [], city: '' });
window.__extraState = () => JSON.parse(JSON.stringify(state));
createApp({
  setup: () => ({
    ...toRefs(state),
    skillOptions: ['Vue', 'Rust', 'Go', 'TypeScript'],
    cities: ['Brisbane', 'Sydney', 'Melbourne', 'Perth', 'Adelaide', 'Hobart city'],
  }),
}).use(ElementPlus).mount('#app');`;

test.describe('Element Plus drivers on widgets outside the fixture (element-plus full build)', () => {
  test.beforeEach(async ({ page: p }) => {
    page = p;
    await page.goto('about:blank');
    await page.setContent(`<!doctype html><html><head><meta charset="utf-8"></head><body>${EXTRA_HTML}</body></html>`);
    await page.addStyleTag({ path: path.join(EP_DIR, 'dist', 'index.css') });
    await page.addScriptTag({ path: VUE_GLOBAL });
    await page.addScriptTag({ path: path.join(EP_DIR, 'dist', 'index.full.min.js') });
    await page.addScriptTag({ content: EXTRA_SCRIPT });
    await page.waitForSelector('.el-form .el-date-editor');
    await injectHarness(page);
  });

  const extra = () => page.evaluate(() => (window as unknown as { __extraState: () => Record<string, unknown> }).__extraState());

  test('date picker (day granularity): attempt 1 types YYYY-MM-DD', async () => {
    expect(await findControlByLabel(page, 'Start date')).toMatchObject({ kind: 'date', lib: 'element' });
    const report = await execIntent(page, 'Start date', { kind: 'date', display: '2024-07-15', year: 2024, month: 7, day: 15 });
    expect(report).toMatchObject({ outcome: 'filled', observed: '2024-07-15' });
    expect((await extra()).date).toBe('2024-07-15');
    await noPopperOpen();
  });

  test('date picker (day granularity): attempt 2 navigates year → month → day cells', async () => {
    const { result } = await runAttempt('Start date', 2, { kind: 'date', display: '2019-02-03', year: 2019, month: 2, day: 3 });
    expect(result).toMatchObject({ ok: true, observed: '2019-02-03' });
    expect((await extra()).date).toBe('2019-02-03');
    await noPopperOpen();
  });

  test('date picker: the same year and a later month only needs the month and day cells', async () => {
    const year = new Date().getFullYear();
    const { result } = await runAttempt('Start date', 2, { kind: 'date', display: 'x', year, month: 1, day: 20 });
    expect(result).toMatchObject({ ok: true, observed: `${year}-01-20` });
    expect((await extra()).date).toBe(`${year}-01-20`);
  });

  test('multiple select: ticks every item, keeps earlier ones and never deselects', async () => {
    const first = await execIntent(page, 'Skills', {
      kind: 'multi',
      display: 'Vue, Rust',
      items: [{ query: 'Vue' }, { query: 'Rust' }],
    });
    expect(first).toMatchObject({ outcome: 'filled', observed: 'Vue, Rust' });
    expect((await extra()).skills).toEqual(['Vue', 'Rust']);
    await noPopperOpen();
    const second = await execIntent(page, 'Skills', {
      kind: 'multi',
      display: 'Vue, Go',
      items: [{ query: 'Vue' }, { query: 'Go' }],
    });
    expect(second.outcome).toBe('filled');
    expect((await extra()).skills).toEqual(['Vue', 'Rust', 'Go']);
    await noPopperOpen();
  });

  test('multiple select: a missing item → no_option, popper closed', async () => {
    const report = await execIntent(page, 'Skills', {
      kind: 'multi',
      display: 'Vue, Haskell',
      items: [{ query: 'Vue' }, { query: 'Haskell' }],
    });
    expect(report.outcome).toBe('no_option');
    await noPopperOpen();
  });

  test('local filterable select: found without typing', async () => {
    const report = await execIntent(page, 'City', choice('Perth'));
    expect(report).toMatchObject({ outcome: 'filled', observed: 'Perth' });
    expect((await extra()).city).toBe('Perth');
    await noPopperOpen();
  });

  test('local filterable select: typing the query finds nothing → no_option quickly', async () => {
    const started = Date.now();
    const report = await execIntent(page, 'City', choice('Atlantis'));
    expect(report.outcome).toBe('no_option');
    expect((await extra()).city).toBe('');
    expect(Date.now() - started).toBeLessThan(2500);
    await noPopperOpen();
  });

  test('local filterable select: ambiguous (two cities contain "ney" / "ur") → needs_review', async () => {
    const report = await runContains('City', 'e');
    expect(report.outcome).toBe('needs_review');
    expect((await extra()).city).toBe('');
    await noPopperOpen();
  });
});

