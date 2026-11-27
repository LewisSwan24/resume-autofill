// The recorder build, loaded as an applicant would load it, records a tab and hands over a sanitised bundle.
// Needs `pnpm build:recorder`: the store build tested by the rest of this folder has no recorder at all.
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect, test } from '@playwright/test';
import type { CaptureBundle } from '../../src/capture/bundle';
import { createSampleProfile } from '../../src/schema/samples';
import { fixtureUrl } from './helpers';

const RECORDER_EXT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../.output/chrome-mv3-recorder');

test('records a tab of its own browser into a bundle with no resume value in it', async ({ headless }) => {
  expect(existsSync(path.join(RECORDER_EXT, 'recorder.html')), 'run pnpm build:recorder first').toBe(true);
  const context = await chromium.launchPersistentContext('', {
    channel: 'chromium',
    headless: headless && !process.env.HEADED,
    acceptDownloads: true,
    args: [`--disable-extensions-except=${RECORDER_EXT}`, `--load-extension=${RECORDER_EXT}`],
  });
  try {
    const worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
    const id = new URL(worker.url()).host;

    const target = await context.newPage();
    const url = fixtureUrl('native');
    await target.goto(url);
    const title = await target.title();

    const recorder = await context.newPage();
    await recorder.goto(`chrome-extension://${id}/recorder.html`);
    await recorder.getByLabel('分页').selectOption({ label: title });
    await recorder.getByLabel('平台').fill('synthetic');
    await recorder.getByLabel('样本名').fill('native');
    const start = recorder.getByRole('button', { name: '开始' });
    // Enabled once every kept resume has been read for its values.
    await expect(start).toBeEnabled({ timeout: 15_000 });
    await start.click();

    await expect(recorder.getByText(/录制中：已听到 [1-9]\d* 个请求/)).toBeVisible({ timeout: 15_000 });
    await target.waitForLoadState('load');
    // What a signed-in page shows that the sanitiser must not let through: each kept resume's full name. A bare Latin
    // given name is left alone by design (src/capture/sanitize.ts resumeTerms): it would match ordinary words.
    const names = createSampleProfile().resumes.map(({ basics: b }) =>
      /\p{Script=Han}/u.test(b.familyName) ? `${b.familyName}${b.givenName}` : `${b.givenName} ${b.familyName}`,
    );
    await target.evaluate((list) => {
      const p = document.createElement('p');
      p.textContent = `Signed in as ${list.join(' / ')}`;
      document.body.append(p);
    }, names);

    const downloading = recorder.waitForEvent('download');
    await recorder.getByRole('button', { name: '停止并导出' }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe('synthetic-native.raf-capture.json');
    const bundle = JSON.parse(readFileSync((await download.path())!, 'utf8')) as CaptureBundle;

    expect(bundle.meta).toMatchObject({ ats: 'synthetic', name: 'native', url, recordedWith: 'chrome', screenshots: [] });
    const doc = bundle.har.log.entries.find((e) => e.request.url === url);
    expect(doc?.response.status).toBe(200);
    expect(doc?.response.content.text).toContain('<form');
    expect(bundle.pages[0]!.file).toBe('page.html');
    expect(bundle.pages[0]!.html).toContain('Signed in as');
    expect(names).toHaveLength(2);
    for (const name of names) expect(JSON.stringify(bundle)).not.toContain(name);
    await expect(recorder.getByText('已导出。')).toBeVisible();
  } finally {
    await context.close();
  }
});
