import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

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

const fixtureState = (page: Page): Promise<State> => page.evaluate(() => window.__fixtureState());

declare global {
  interface Window {
    __fixtureState: () => Record<string, unknown>;
  }
}

test.describe('fixture site', () => {
  test('root index links to every page', async ({ page }) => {
    await page.goto('/');
    const hrefs = await page.locator('a').evaluateAll((as) => as.map((a) => a.getAttribute('href')));
    expect(hrefs).toEqual(expect.arrayContaining(['./native/', './antd/', './element/']));
  });

  for (const name of ['antd', 'element']) {
    test(`${name} page loads and exposes __fixtureState`, async ({ page }) => {
      const res = await page.goto(`/${name}/`);
      expect(res?.ok()).toBe(true);
      expect(await page.evaluate(() => typeof window.__fixtureState)).toBe('function');
    });
  }
});

test.describe('native fixture (en-AU)', () => {
  const { meta, state: expected } = loadExpected('native');

  test('initial __fixtureState is all-empty and has a stable key set', async ({ page }) => {
    await page.goto('/native/');
    await page.frameLocator('iframe[title="Additional questions"]').getByLabel('Notice period').waitFor();
    const initial = await fixtureState(page);

    // One employment card initially: everything from employment[1] is absent until "+ Add another".
    const expectedInitialKeys = Object.keys(expected).filter((k) => !k.startsWith('employment[1].'));
    expect(Object.keys(initial).sort()).toEqual(expectedInitialKeys.sort());
    for (const [k, v] of Object.entries(initial)) expect(v, k).toEqual(emptyLike(expected[k]));
    expect(await page.locator('div.card').count()).toBe(1);
  });

  test('"+ Add another" appends an identical employment card', async ({ page }) => {
    await page.goto('/native/');
    await page.getByRole('button', { name: '+ Add another' }).click();
    await expect(page.locator('div.card')).toHaveCount(2);
    const state = await fixtureState(page);
    for (const k of ['jobTitle', 'company', 'start', 'end', 'current', 'description']) {
      expect(state).toHaveProperty([`employment[1].${k}`]);
    }
  });

  test('preferred-location select cannot hold the resume city', async ({ page }) => {
    await page.goto('/native/');
    const labels = await page.locator('#preferred-location option').allTextContents();
    expect(labels).toEqual(['Select', 'Sydney', 'Melbourne', 'Perth']);
    expect(meta.__review).toEqual(['preferredLocation']);
  });

  test('filling the form with Playwright reproduces expected.json', async ({ page }) => {
    const e = expected as Record<string, string | boolean | string[]>;
    const s = (k: string) => e[k] as string;
    await page.goto('/native/');

    // Personal details: label[for], label[for], wrapping label, aria-label only, placeholder only.
    await page.getByLabel('First name').fill(s('firstName'));
    await page.getByLabel('Last name').fill(s('lastName'));
    await page.getByLabel('Preferred name').fill(s('preferredName'));
    await page.getByLabel('Email', { exact: true }).fill(s('email'));
    await page.getByLabel('Country code').selectOption({ label: s('phoneCountryCode') });
    await page.getByPlaceholder('Mobile number').fill(s('mobileNumber'));
    await page.getByLabel('Pronouns').selectOption({ label: s('pronouns') });

    // Address.
    await page.getByLabel('Street').fill(s('street'));
    await page.getByLabel('Suburb/City').fill(s('suburb'));
    await page.getByLabel('State').selectOption({ label: s('state') });
    await page.getByLabel('Postcode').fill(s('postcode'));

    // Links: name-only and id+placeholder inputs.
    await page.locator('input[name="linkedin_url"]').fill(s('linkedinUrl'));
    await page.locator('#githubProfile').fill(s('githubProfile'));

    // Work rights.
    await page.getByLabel('Work rights in Australia').selectOption({ label: s('workRights') });
    await page.getByLabel('Visa expiry date').fill(s('visaExpiry'));
    await page
      .getByRole('radiogroup', { name: 'Will you now or in the future require sponsorship?' })
      .getByLabel(s('requiresSponsorship'), { exact: true })
      .check();

    // Education table (cells identified by position; headers are the only labels).
    for (let i = 0; i < 2; i++) {
      const cells = page.locator('#education tbody tr').nth(i).locator('td');
      await cells.nth(0).locator('input').fill(s(`education[${i}].institution`));
      await cells.nth(1).locator('select').selectOption({ label: s(`education[${i}].degree`) });
      await cells.nth(2).locator('input').fill(s(`education[${i}].fieldOfStudy`));
      await cells.nth(3).locator('input').fill(s(`education[${i}].start`));
      await cells.nth(4).locator('input').fill(s(`education[${i}].end`));
    }

    // Employment: second card needs the add button.
    await page.getByRole('button', { name: '+ Add another' }).click();
    for (let i = 0; i < 2; i++) {
      const card = page.locator('div.card').nth(i);
      await card.getByLabel('Job title').fill(s(`employment[${i}].jobTitle`));
      await card.getByLabel('Company').fill(s(`employment[${i}].company`));
      await card.getByLabel('Start', { exact: true }).fill(s(`employment[${i}].start`));
      if (s(`employment[${i}].end`)) await card.getByLabel('End', { exact: true }).fill(s(`employment[${i}].end`));
      if (e[`employment[${i}].current`]) await card.getByLabel('I currently work here').check();
      await card.getByLabel('Description').fill(s(`employment[${i}].description`));
    }

    // preferredLocation is intentionally left alone (no matching option).
    await page.getByRole('textbox', { name: 'Tell us about yourself' }).fill(s('aboutYou'));
    await page.getByLabel('Resume/CV').setInputFiles({
      name: (e.resume as string[])[0]!,
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 fixture'),
    });
    await page
      .getByLabel('Do you identify as Aboriginal or Torres Strait Islander?')
      .selectOption({ label: s('indigenousStatus') });
    await page.getByLabel('How did you hear about us?').selectOption({ label: s('howDidYouHear') });

    // Same-origin iframe.
    const frame = page.frameLocator('iframe[title="Additional questions"]');
    await frame.getByLabel('Notice period').fill(s('frame.noticePeriod'));
    await frame.getByLabel('Earliest start date').fill(s('frame.earliestStartDate'));

    // Traps (verification code, privacy checkbox) stay untouched.
    expect(await fixtureState(page)).toEqual(expected);
  });
});
