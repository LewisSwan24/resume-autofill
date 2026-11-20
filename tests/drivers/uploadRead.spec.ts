// A form that stores the uploaded resume before it reads it: the sign that it is reading comes a round trip or
// two after the file was taken, the fields are locked while it reads, and then it writes over them.
import { expect, test } from '@playwright/test';
import { injectHarness } from './helpers';

for (const storeMs of [0, 1500]) {
  test(`fills the rest only after the page has read the resume, which starts ${storeMs} ms after the upload`, async ({ page }) => {
    await page.goto(`/upload-read/?store=${storeMs}&read=700`);
    await page.locator('[data-testid="input-first_name"]').waitFor();
    await injectHarness(page);
    const seen = await page.evaluate(async () => {
      const raf = window.__raf;
      const resume = raf.samples.resumes.find((r) => r.locale === 'en-AU')!;
      const run = await raf.runFill(document, { resume, files: raf.sampleFiles });
      // Long enough for the page to have written, had it not finished before the fill.
      await new Promise((resolve) => setTimeout(resolve, 2500));
      const value = (name: string): string => document.querySelector<HTMLInputElement>(`[data-testid="input-${name}"]`)!.value;
      // The page's own record, set by fixtures/synthetic/upload-read/upload-read.ts.
      const page = (window as unknown as { __uploadRead: { read: boolean; writesWhileLocked: number } }).__uploadRead;
      return {
        read: page.read,
        writesWhileLocked: page.writesWhileLocked,
        first: value('first_name'),
        email: value('email'),
        rows: run.report.fields.map((f) => `${f.label}: ${f.outcome} ${f.fieldKey ?? ''}`),
      };
    });
    const rows = seen.rows.join(' | ');
    expect(seen.read, rows).toBe(true);
    expect(seen.rows.some((r) => /attachments\.resume/.test(r) && /filled/.test(r)), rows).toBe(true);
    expect(seen.writesWhileLocked, rows).toBe(0);
    expect(seen.first, rows).not.toBe('Parsed');
    expect(seen.first, rows).not.toBe('');
    expect(seen.email, rows).not.toBe('parsed@example.test');
  });
}

// The wait for the sign and the wait for the read share one budget, so a page that starts reading late and never
// finishes holds the fill no longer than one that reads at once: the whole fill has to fit the frame's 30 s.
test('a read that starts late and never ends holds the fill no longer than the read budget', async ({ page }) => {
  test.setTimeout(60_000);
  await page.goto('/upload-read/?store=5000&read=60000');
  await page.locator('[data-testid="input-first_name"]').waitFor();
  await injectHarness(page);
  const ms = await page.evaluate(async () => {
    const raf = window.__raf;
    const resume = raf.samples.resumes.find((r) => r.locale === 'en-AU')!;
    const started = performance.now();
    await raf.runFill(document, { resume, files: raf.sampleFiles });
    return performance.now() - started;
  });
  // 15 s of waiting, plus the few fields after it.
  expect(ms).toBeLessThan(17_000);
});

test('an upload that is not the resume does not hold the rest of the fill for a read that never comes', async ({ page }) => {
  await page.goto('/upload-read/?box=photo&store=0&read=700');
  await page.locator('[data-testid="input-first_name"]').waitFor();
  await injectHarness(page);
  const seen = await page.evaluate(async () => {
    const raf = window.__raf;
    const base = raf.samples.resumes.find((r) => r.locale === 'en-AU')!;
    const resume = { ...base, attachments: { ...base.attachments, resumeFileId: undefined, photoFileId: 'sample-photo' } };
    const started = performance.now();
    const run = await raf.runFill(document, { resume, files: raf.sampleFiles });
    return {
      ms: performance.now() - started,
      rows: run.report.fields.map((f) => `${f.label}: ${f.outcome} ${f.fieldKey ?? ''}`),
    };
  });
  const rows = seen.rows.join(' | ');
  expect(seen.rows.some((r) => /attachments\.photo/.test(r) && /filled/.test(r)), rows).toBe(true);
  expect(seen.rows.some((r) => /First name: filled/.test(r)), rows).toBe(true);
  // The resume's long sign window is 6 s; without it the fill takes well under one.
  expect(seen.ms, rows).toBeLessThan(3000);
});
