// Zoho's Lyte lists, driven on a stand-in that behaves the way the real ones were seen to: the box moves to the end
// of <body> when opened, a list that takes several stays open. The real page is still the real proof.
import { expect, test, type Page } from '@playwright/test';
import type { FillReport } from '../../src/engine/types';
import { mountLyte, WORK_RIGHTS, zohoForm } from '../shared/zohoForm';
import { execIntent, injectHarness } from './helpers';

let page: Page;

async function mount(opts: Parameters<typeof zohoForm>[0] = {}): Promise<void> {
  await page.evaluate((html) => {
    document.body.innerHTML = html;
  }, zohoForm(opts));
  await page.evaluate(mountLyte);
}

test.beforeEach(async ({ page: p }) => {
  page = p;
  await page.goto('/aria/');
  await page.getByLabel('First Name', { exact: true }).waitFor();
  await injectHarness(page);
});

const row = (zcqa: string) => page.locator(`[data-zcqa="${zcqa}"]`);
const openBoxes = () => page.locator('body > lyte-drop-box');
const tags = (zcqa: string) => row(zcqa).locator('li[data-value]');

test.describe('Zoho', () => {
  test('a list picks what fits and shuts', async () => {
    await mount();
    const r = await execIntent(page, 'Salutation', { kind: 'choice', display: 'Ms.', query: 'Ms.' });
    expect(r.outcome).toBe('filled');
    expect(r.observed).toBe('Ms.');
    await expect(row('rec_Salutation').locator('.lyteDropdownLabel')).toHaveText('Ms.');
    await expect(openBoxes()).toHaveCount(0);
  });

  test('nothing fitting picks nothing, and the list is shut after', async () => {
    await mount();
    const r = await execIntent(page, 'Salutation', { kind: 'choice', display: 'Dr.', query: 'Dr.' });
    expect(r.outcome).toBe('no_option');
    await expect(row('rec_Salutation').locator('.lyteDropPlaceholderNormal')).toHaveText('-None-');
    await expect(openBoxes()).toHaveCount(0);
  });

  test('the phone’s country, by name and code', async () => {
    await mount();
    const r = await execIntent(page, 'Mobile country code', { kind: 'choice', display: '+61', query: '+61', options: { matchLabel: 'Australia +61' } });
    expect(r.outcome).toBe('filled');
    await expect(row('rec_Mobile').locator('lyte-yield[selected-value="AU"] .flag-drop-code')).toHaveText('(+61)');
    await expect(openBoxes()).toHaveCount(0);
  });

  test('a list that takes several ticks the answer, and is shut after though it stays open by itself', async () => {
    await mount();
    const r = await execIntent(page, 'Working rights in Australia', { kind: 'multi', display: WORK_RIGHTS[1]!, items: [{ query: WORK_RIGHTS[1]! }] });
    expect(r.outcome).toBe('filled');
    await expect(tags('rec_Working_rights_in_Australia')).toHaveText([WORK_RIGHTS[1]!]);
    await expect(openBoxes()).toHaveCount(0);
  });

  test('a fill picks the resume’s work rights on the list as Zoho words them, misspelt as they are', async () => {
    await mount();
    const report: FillReport = await page.evaluate(async () => {
      const raf = window.__raf;
      const resume = raf.samples.resumes.find((r) => r.locale === 'en-AU')!;
      return (await raf.runFill(document, { resume, files: raf.sampleFiles })).report;
    });
    // The sample resume holds a graduate visa: temporary, and with no restrictions on work.
    expect(report.fields.find((f) => f.fieldKey === 'workRights.status')).toMatchObject({ outcome: 'filled' });
    await expect(tags('rec_Working_rights_in_Australia')).toHaveText([WORK_RIGHTS[1]!]);
  });

  test('a fill leaves a list that already shows another answer as it is, and asks about it', async () => {
    await mount({ workRights: [WORK_RIGHTS[0]!] });
    const report: FillReport = await page.evaluate(async () => {
      const raf = window.__raf;
      const resume = raf.samples.resumes.find((r) => r.locale === 'en-AU')!;
      return (await raf.runFill(document, { resume, files: raf.sampleFiles })).report;
    });
    const rights = report.fields.find((f) => f.fieldKey === 'workRights.status');
    expect(rights).toMatchObject({ outcome: 'needs_review', note: 'answer_held', observed: WORK_RIGHTS[0] });
    await expect(tags('rec_Working_rights_in_Australia')).toHaveText([WORK_RIGHTS[0]!]);
    // The rest of the row-labelled form fills.
    const filled = report.fields.filter((f) => f.outcome === 'filled').map((f) => f.fieldKey);
    expect(filled).toEqual(expect.arrayContaining(['basics.givenName', 'basics.familyName', 'contact.email', 'contact.phone', 'contact.addressCity', 'contact.postcode']));
    await expect(openBoxes()).toHaveCount(0);
  });
});
