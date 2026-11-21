// Core quality gate of M1: runFill (scan → add cards → plan → drivers → report) on every synthetic fixture
// must reproduce fixtures/synthetic/<name>/expected.json exactly, leave the review fields empty (reported
// as needs_review / no_option) and never touch the trap fields.
import { expect, test, type Frame, type Page } from '@playwright/test';
import type { FieldReport, FillReport } from '../../src/engine/types';
import { FIXTURE_SPECS, compareState, emptyLike, loadExpected, same, type State } from '../shared/fixtureExpectations';
import { fixtureState, injectHarness } from './helpers';

declare global {
  interface Window {
    __fixtureState: () => Record<string, unknown>;
  }
}

async function runFillIn(target: Page | Frame, locale: string): Promise<FillReport> {
  await injectHarness(target);
  return target.evaluate(async (loc) => {
    const raf = window.__raf;
    const resume = raf.samples.resumes.find((r) => r.locale === loc);
    if (!resume) throw new Error(`no sample resume for ${loc}`);
    // Ids that stay with their element from one run to the next, as the content script keeps them.
    const w = window as unknown as { __runIds?: WeakMap<HTMLElement, string> };
    const ids = (w.__runIds ??= new WeakMap());
    const idFor = (el: HTMLElement) => ids.get(el) ?? (ids.set(el, `r${Math.random().toString(36).slice(2)}`), ids.get(el)!);
    const run = await raf.runFill(document, { resume, files: raf.sampleFiles }, { idFor });
    return run.report;
  }, locale);
}

for (const spec of FIXTURE_SPECS) {
  test.describe(`runFill on the ${spec.name} fixture`, () => {
    const { meta, state: expected } = loadExpected(spec.name);
    const locale = meta.__resume as string;
    const reviewKeys = (meta.__review ?? []) as string[];
    let reports: FillReport[] = [];
    let state: State = {};

    test.beforeAll(async ({ browser }) => {
      const page = await browser.newPage({ baseURL: 'http://localhost:4173' });
      try {
        await page.goto(`/${spec.name}/`);
        if (spec.frame) {
          await page.frameLocator('iframe[title="Additional questions"]').getByLabel('Notice period').waitFor();
        }
        reports = [await runFillIn(page, locale)];
        if (spec.frame) {
          const frame = page.frames().find((f) => f.url().endsWith('/native/frame.html'));
          if (!frame) throw new Error('fixture iframe not found');
          reports.push(await runFillIn(frame, locale));
        }
        state = await fixtureState(page);
      } finally {
        await page.close();
      }
    });

    const allFields = () => reports.flatMap((r) => r.fields);

    test('__fixtureState matches expected.json key by key (accuracy table)', () => {
      const keys = Object.keys(expected);
      const { rows, extra, good } = compareState(state, expected);
      const counts = reports.map((r) => r.counts);
      const lines = [
        `\n[runFill] ${spec.name}: ${good}/${keys.length} keys correct = ${((100 * good) / keys.length).toFixed(1)} %`,
        ...rows.filter((r) => !r.ok).map((r) => `  ✗ ${r.key}: expected ${JSON.stringify(r.expected)} got ${JSON.stringify(r.actual)}`),
        ...extra.map((k) => `  ? unexpected state key ${k}`),
        `  outcomes: ${JSON.stringify(counts)}`,
      ];
      if (process.env.RUNFILL_DEBUG) {
        for (const f of allFields()) {
          lines.push(
            `  · ${f.fieldId} ${f.outcome} ${f.fieldKey ?? '-'} (${f.confidence}) "${f.label}" → ${f.observed ?? f.value ?? ''}`,
          );
        }
      }
      console.log(lines.join('\n'));
      expect(rows.filter((r) => !r.ok).map((r) => r.key)).toEqual([]);
      expect(extra).toEqual([]);
      expect(good).toBe(keys.length);
    });

    test('review fields are reported needs_review / no_option and stay empty', () => {
      expect(Object.keys(spec.review).sort()).toEqual([...reviewKeys].sort());
      for (const key of reviewKeys) {
        expect(state[key], `${key} must stay empty`).toEqual(emptyLike(expected[key]));
        const label = spec.review[key]!;
        const hits = allFields().filter((f: FieldReport) => label.test(f.label));
        expect(hits.length, `${key}: report row`).toBeGreaterThan(0);
        for (const h of hits) expect(['needs_review', 'no_option'], `${key}: ${h.outcome}`).toContain(h.outcome);
      }
    });

    test('checkbox rows carry the form-item label, never the wrapped 是 / 否', () => {
      for (const label of spec.labels ?? []) {
        expect(allFields().some((f) => label.test(f.label)), String(label)).toBe(true);
      }
      expect(allFields().filter((f) => /^(是|否|yes|no)$/i.test(f.label.trim()))).toEqual([]);
    });

    test('traps are never filled', () => {
      for (const trap of spec.traps) {
        const hits = allFields().filter((f) => trap.test(f.label));
        expect(hits.length, `${trap}: report row`).toBeGreaterThan(0);
        for (const h of hits) expect(h.outcome, `${trap}`).not.toBe('filled');
      }
    });

    test('report is consistent: counts add up, no action_failed / no_control rows', () => {
      for (const r of reports) {
        const total = Object.values(r.counts).reduce((a, b) => a + b, 0);
        expect(total).toBe(r.fields.length);
        expect(r.counts.action_failed).toBe(0);
        expect(r.counts.no_control).toBe(0);
        expect(r.finishedAt).toBeGreaterThanOrEqual(r.startedAt);
      }
      expect(reports[0]!.counts.filled).toBeGreaterThan(0);
      for (const f of allFields().filter((x) => x.outcome === 'filled')) {
        expect(f.observed, `${f.label} read back`).not.toBeNull();
      }
    });
  })
  test.describe(`runFill twice on the ${spec.name} fixture`, () => {
    const { meta, state: expected } = loadExpected(spec.name);

    test('a second run is idempotent (same classification, no duplicated uploads, state unchanged)', async ({ page }) => {
      await page.goto(`/${spec.name}/`);
      if (spec.frame) await page.frameLocator('iframe[title="Additional questions"]').getByLabel('Notice period').waitFor();
      const first = await runFillIn(page, meta.__resume as string);
      const second = await runFillIn(page, meta.__resume as string);
      const state = await fixtureState(page);
      const topKeys = Object.keys(expected).filter((k) => !k.startsWith('frame.'));
      expect(topKeys.filter((k) => !same(state[k], expected[k]))).toEqual([]);
      // The entries the first run filled are the page's own by now: left alone, and reported as already there. Every
      // other row comes back exactly as it was.
      const rows = (r: FillReport) => r.fields.map((f) => `${f.fieldId} ${f.outcome}`);
      const held = new Set(second.fields.filter((f) => f.note === 'entry_held').map((f) => f.fieldId));
      expect(first.fields.filter((f) => f.note === 'entry_held')).toEqual([]);
      expect(second.fields.map((f) => f.fieldId)).toEqual(first.fields.map((f) => f.fieldId));
      expect(rows(second).filter((_, i) => !held.has(second.fields[i]!.fieldId))).toEqual(
        rows(first).filter((_, i) => !held.has(first.fields[i]!.fieldId)),
      );
      for (const f of second.fields.filter((x) => held.has(x.fieldId))) expect(f.outcome, f.label).toBe('no_data');
      expect(second.counts.filled).toBeGreaterThan(0);
    });
  });
}
