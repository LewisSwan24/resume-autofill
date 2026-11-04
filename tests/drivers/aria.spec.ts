// ARIA combobox driver on react-select and hand-written widgets (fixtures/synthetic/aria).
import { expect, test, type Page } from '@playwright/test';
import { execIntent, fixtureState, findControlByLabel, injectHarness, type IntentJson, type Target } from './helpers';

let page: Page;

test.beforeEach(async ({ page: p }) => {
  page = p;
  await page.goto('/aria/');
  await page.getByLabel('First Name', { exact: true }).waitFor();
  await injectHarness(page);
});

const choice = (query: string, matchLabel = query): IntentJson => ({
  kind: 'choice',
  display: matchLabel,
  query,
  options: { matchLabel },
});

const openLists = (target: Target) =>
  target.evaluate(() => [...document.querySelectorAll('[role=listbox]')].filter((l) => l.getClientRects().length > 0).length);

test('every combobox is discovered once, with no hidden companion inputs', async () => {
  const labels = await page.evaluate(() => window.__raf.listLabels());
  for (const name of [
    'Country',
    'Highest degree',
    'Preferred cities',
    'University',
    'How did you hear about us?',
    'Employment type',
    'City',
    'Current location',
    'Visa type',
  ]) {
    const hits = labels.filter((l) => l.endsWith(`:${name}`));
    expect(hits, name).toHaveLength(1);
    expect(hits[0], name).toContain(':select:');
  }
  // The `required` companion input of react-select has no label of its own.
  expect(labels.filter((l) => /:$/.test(l))).toEqual([]);
  expect((await findControlByLabel(page, 'Employment type')).lib).toBe('aria');
});

test('react-select: the shown value may be shorter than the option', async () => {
  const r = await execIntent(page, 'Country', choice('Australia +61'));
  expect(r.outcome).toBe('filled');
  expect(r.observed).toBe('+61');
  expect((await fixtureState(page)).country).toBe('+61');
  expect(await openLists(page)).toBe(0);
});

test('react-select: generated class names only', async () => {
  const r = await execIntent(page, 'Highest degree', choice('Master'));
  expect(r.outcome).toBe('filled');
  expect(r.observed).toBe('Master');
  expect((await fixtureState(page)).degree).toBe('Master');
});

test('react-select: a second fill replaces the value', async () => {
  await execIntent(page, 'Highest degree', choice('Master'));
  const r = await execIntent(page, 'Highest degree', choice('Bachelor'));
  expect(r.outcome).toBe('filled');
  expect((await fixtureState(page)).degree).toBe('Bachelor');
});

test('react-select: filling the same value twice changes nothing', async () => {
  await execIntent(page, 'Country', choice('Australia +61'));
  const r = await execIntent(page, 'Country', choice('Australia +61'));
  expect(r.outcome).toBe('filled');
  expect((await fixtureState(page)).country).toBe('+61');
});

test('react-select: multi adds every value', async () => {
  const r = await execIntent(page, 'Preferred cities', {
    kind: 'multi',
    display: 'Brisbane, Sydney',
    items: [{ query: 'Brisbane' }, { query: 'Sydney' }],
  });
  expect(r.outcome).toBe('filled');
  expect((await fixtureState(page)).cities).toEqual(['Brisbane', 'Sydney']);
  expect(await openLists(page)).toBe(0);
});

test('react-select: multi with one missing value selects nothing', async () => {
  const r = await execIntent(page, 'Preferred cities', {
    kind: 'multi',
    display: 'Brisbane, Atlantis',
    items: [{ query: 'Brisbane' }, { query: 'Atlantis' }],
  });
  expect(r.outcome).toBe('no_option');
  expect((await fixtureState(page)).cities).toEqual([]);
});

test('react-select: options that only load after typing', async () => {
  const r = await execIntent(page, 'University', choice('Queensland', 'The University of Queensland'));
  expect(r.outcome).toBe('filled');
  expect((await fixtureState(page)).university).toBe('The University of Queensland');
});

test('react-select: no match leaves the field untouched', async () => {
  const r = await execIntent(page, 'Visa type', choice('Bridging visa'));
  expect(r.outcome).toBe('no_option');
  expect((await fixtureState(page)).visaType).toBe('');
  await expect(page.locator('#visa_type')).toHaveValue('');
  expect(await openLists(page)).toBe(0);
});

test('input combobox: options in a portal, selected on mousedown', async () => {
  const r = await execIntent(page, 'How did you hear about us?', choice('LinkedIn'));
  expect(r.outcome).toBe('filled');
  expect((await fixtureState(page)).heard).toBe('LinkedIn');
  await expect(page.locator('#heard')).toHaveValue('LinkedIn');
  expect(await openLists(page)).toBe(0);
});

test('input combobox: options that only load after typing', async () => {
  const r = await execIntent(page, 'City', choice('Melbourne', 'Melbourne VIC, Australia'));
  expect(r.outcome).toBe('filled');
  expect((await fixtureState(page)).city).toBe('Melbourne VIC, Australia');
});

test('input combobox: no match clears what was typed', async () => {
  const r = await execIntent(page, 'City', choice('Atlantis'));
  expect(r.outcome).toBe('no_option');
  expect((await fixtureState(page)).city).toBe('');
  await expect(page.locator('#city')).toHaveValue('');
  expect(await openLists(page)).toBe(0);
});

test('button combobox: labelled by another element, list only exists while open', async () => {
  const r = await execIntent(page, 'Employment type', choice('Graduate program'));
  expect(r.outcome).toBe('filled');
  expect((await fixtureState(page)).employment).toBe('Graduate program');
  expect(await openLists(page)).toBe(0);
});

test('answer buttons: found as one question, labelled through the hidden checkbox', async () => {
  const found = await findControlByLabel(page, 'Are you legally authorised to work in Australia?');
  expect(found.kind).toBe('radio');
  expect(found.lib).toBe('aria');
});

test('answer buttons: pressing one answers the question', async () => {
  const r = await execIntent(page, 'Are you legally authorised to work in Australia?', choice('Yes'));
  expect(r.outcome).toBe('filled');
  expect(r.observed).toBe('Yes');
  expect((await fixtureState(page)).authorised).toBe('Yes');
});

test('answer buttons: answering again changes nothing', async () => {
  await execIntent(page, 'Are you legally authorised to work in Australia?', choice('Yes'));
  const r = await execIntent(page, 'Are you legally authorised to work in Australia?', choice('Yes'));
  expect(r.outcome).toBe('filled');
  expect((await fixtureState(page)).authorised).toBe('Yes');
});

test('answer buttons: no match presses nothing', async () => {
  const r = await execIntent(page, 'Have you worked for us before?', choice('Maybe'));
  expect(r.outcome).toBe('no_option');
  expect((await fixtureState(page)).workedHere).toBe('');
});

test('button combobox: no match closes the list', async () => {
  const r = await execIntent(page, 'Employment type', choice('Casual'));
  expect(r.outcome).toBe('no_option');
  expect((await fixtureState(page)).employment).toBe('');
  expect(await openLists(page)).toBe(0);
});
