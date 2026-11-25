// Extension regression: the real user journey (install → open fixture → click FAB → fields filled) on every
// synthetic fixture, compared with fixtures/synthetic/<name>/expected.json.
import { expect, test } from './fixtures';
import {
  accessibleNames,
  fillFixture,
  recordAccuracy,
  rowsOf,
  screenshotFab,
} from './helpers';
import { FIXTURE_SPECS, compareState, emptyLike, loadExpected } from '../shared/fixtureExpectations';

/** One control per fixture that is certain to be filled (see expected.json) and its CSS selector. */
const FILLED_PROBE: Record<string, string> = {
  native: '#first-name',
  antd: '.ant-form-item:has(.ant-form-item-label label[title="姓名"]) input',
  element: '.el-form-item:has(> .el-form-item__label:text-is("姓名")) input',
  aria: '#first_name',
  'questions-zh': '#shift',
  'questions-en': '#arrangement',
  'languages-works': '#wt',
};
const GREEN = 'rgb(34, 197, 94)'; // HIGHLIGHT_COLORS.filled = #22c55e

for (const spec of FIXTURE_SPECS) {
  test(`fill ${spec.name} fixture via the FAB`, async ({ context, serviceWorker }) => {
    const { meta, state: expected } = loadExpected(spec.name);
    const reviewKeys = (meta.__review ?? []) as string[];
    const { page, report, detected, fabDetected } = await fillFixture(context, serviceWorker, spec.name, meta.__resume as string, {
      frame: spec.frame,
    });

    expect(fabDetected, 'count shown on the FAB == scanned count').toBe(detected);

    // --- accuracy: __fixtureState() vs expected.json, key by key
    const state = await page.evaluate(() => window.__fixtureState());
    const { rows, extra, good } = compareState(state, expected);
    const total = rows.length;
    const accuracy = Math.round((1000 * good) / total) / 10;
    const all = recordAccuracy({
      fixture: spec.name,
      keys: total,
      correct: good,
      accuracy,
      wrong: rows.filter((r) => !r.ok).map((r) => r.key),
    });
    const table = [
      'fixture   keys  correct  accuracy',
      ...all.map((r) => `${r.fixture.padEnd(9)} ${String(r.keys).padStart(4)}  ${String(r.correct).padStart(7)}  ${r.accuracy.toFixed(1).padStart(7)}%`),
    ].join('\n');
    console.log(`\n[e2e accuracy] detected=${detected}, counts=${JSON.stringify(report.counts)}\n${table}`);
    for (const r of rows.filter((x) => !x.ok)) {
      console.log(`  ✗ ${r.key}: expected ${JSON.stringify(r.expected)} got ${JSON.stringify(r.actual)}`);
    }
    expect(rows.filter((r) => !r.ok).map((r) => r.key), 'wrong keys').toEqual([]);
    expect(extra, 'unexpected state keys').toEqual([]);

    // --- review fields: reported needs_review / no_option and left empty
    for (const key of reviewKeys) {
      expect(state[key], `${key} must stay empty`).toEqual(emptyLike(expected[key]));
      const hits = rowsOf(report, spec.review[key]!);
      expect(hits.length, `${key}: report row`).toBeGreaterThan(0);
      for (const h of hits) expect(['needs_review', 'no_option'], `${key}: ${h.outcome}`).toContain(h.outcome);
    }
    // --- traps: reported, never filled
    for (const trap of spec.traps) {
      const hits = rowsOf(report, trap);
      expect(hits.length, `${trap}: report row`).toBeGreaterThan(0);
      for (const h of hits) expect(h.outcome, String(trap)).not.toBe('filled');
    }
    // --- report sanity
    expect(report.counts.filled).toBeGreaterThan(0);
    expect(report.counts.action_failed).toBe(0);
    expect(Object.values(report.counts).reduce((a, b) => a + b, 0)).toBe(report.fields.length);

    // --- green outline on a known filled control
    const outline = await page.locator(FILLED_PROBE[spec.name]!).first().evaluate((el) => getComputedStyle(el).outlineColor);
    expect(outline, 'filled control outline colour').toBe(GREEN);

    // --- the FAB shows the summary card (closed shadow root → read via the accessibility tree)
    await expect
      .poll(async () => (await accessibleNames(page)).some((n) => /填写结果|Autofill result/.test(n)), {
        message: 'FAB summary card',
        timeout: 15_000,
      })
      .toBe(true);
    const names = await accessibleNames(page);
    const filledChip = names.find((n) => /^(已填|Filled) \d+$/.test(n));
    expect(filledChip, `filled stat in FAB (${names.slice(-12).join(' | ')})`).toBeTruthy();
    expect(Number(/\d+/.exec(filledChip!)![0])).toBe(report.counts.filled);
    await screenshotFab(page, `fab-summary-${spec.name}.png`);
  });
}
