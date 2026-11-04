// The reader judges every real-page sample, so it gets its own test on a page with one control of each kind.
// Uses no captured sample, so it also runs on a clean clone.
import { expect, test, type Page } from '@playwright/test';
import { changedControls } from '../shared/capturedExpectations';
import { inspect } from './readState';

const PAGE = `<!doctype html><body>
<label for="t">Text</label><input id="t">
<input name="named" aria-label="Named">
<input type="hidden" id="h" value="hidden-state">
<textarea id="ta"></textarea>
<select id="sel"><option value="">Select...</option><option value="au">Australia</option></select>
<select id="multi" multiple><option value="a">A</option><option value="b">B</option></select>
<label><input type="radio" name="r" value="1">Yes</label><label><input type="radio" name="r" value="0">No</label>
<label><input type="checkbox" name="c" value="x">He/him</label><label><input type="checkbox" name="c" value="y">They/them</label>
<label><input type="checkbox" id="one">Only one</label>
<input type="file" id="f">
<div class="select__control"><div class="select__value-container"><div class="select__single-value" id="shown"></div>
  <input id="combo" role="combobox"></div></div>
<div class="select__control"><input id="combo2" role="combobox"></div>
<div id="host"></div>
<script>document.getElementById('host').attachShadow({mode:'open'}).innerHTML='<input id="deep">';</script>
</body>`;

const LOCATORS = {
  text: '#t',
  named: 'input[name=named]',
  textarea: '#ta',
  select: '#sel',
  multi: '#multi',
  radio: 'input[name=r]',
  checks: 'input[name=c]',
  one: '#one',
  file: '#f',
  combo: '#combo',
  combo2: '#combo2',
  deep: '#deep',
  gone: '#does-not-exist',
};

async function open(page: Page) {
  await page.setContent(PAGE);
  return inspect(page, LOCATORS);
}

test('reads an untouched page as empty', async ({ page }) => {
  const { readings, coverage } = await open(page);
  expect(readings).toEqual({
    text: '', named: '', textarea: '', select: '', multi: [], radio: '', checks: [], one: false, file: [], combo: '', combo2: '', deep: '', gone: null,
  });
  expect(coverage.gone).toEqual([]);
  expect(coverage.checks).toHaveLength(2);
});

test('reads every kind of control after it changes', async ({ page }) => {
  await open(page);
  await page.fill('#t', 'typed');
  await page.fill('input[name=named]', 'by name');
  await page.fill('#ta', 'long text');
  await page.selectOption('#sel', 'au');
  await page.selectOption('#multi', ['a', 'b']);
  await page.check('input[name=r][value="0"]');
  await page.check('input[name=c][value=y]');
  await page.check('#one');
  await page.setInputFiles('#f', { name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') });
  await page.evaluate(() => {
    document.getElementById('shown')!.textContent = '+61';
  });
  await page.fill('#combo2', 'typed into a combobox');
  await page.fill('#deep', 'in shadow');

  const { readings } = await inspect(page, LOCATORS);
  expect(readings).toEqual({
    text: 'typed',
    named: 'by name',
    textarea: 'long text',
    select: 'Australia',
    multi: ['A', 'B'],
    radio: 'No',
    checks: ['They/them'],
    one: true,
    file: ['cv.pdf'],
    combo: '+61',
    combo2: 'typed into a combobox',
    deep: 'in shadow',
    gone: null,
  });
});

test('an exists check matches any element, not only controls', async ({ page }) => {
  await open(page);
  await page.evaluate(() => document.body.insertAdjacentHTML('beforeend', '<div class="progress"></div>'));
  const { readings, coverage } = await inspect(page, { there: 'exists:.progress', absent: 'exists:.nope' });
  expect(readings).toEqual({ there: true, absent: false });
  expect(coverage).toEqual({ there: [], absent: [] });
});

test('a custom select value only counts for its own combobox', async ({ page }) => {
  await open(page);
  await page.evaluate(() => {
    document.getElementById('shown')!.textContent = '+61';
  });
  const { readings } = await inspect(page, LOCATORS);
  expect(readings.combo).toBe('+61');
  expect(readings.combo2).toBe('');
});

test('the snapshot sees every change, ignores hidden inputs and tells repeated names apart', async ({ page }) => {
  const before = await open(page);
  expect(Object.keys(before.snapshot).join()).not.toContain('hidden');
  await page.check('input[name=r][value="1"]');
  await page.check('input[name=c][value=x]');
  await page.fill('#deep', 'x');
  await page.evaluate(() => {
    (document.getElementById('h') as HTMLInputElement).value = 'changed';
  });
  const after = await inspect(page, LOCATORS);
  expect(changedControls(before.snapshot, after.snapshot).map((c) => c.key).sort()).toEqual(['checkbox@c=x', 'radio@r=1', 'text#deep']);
});

test('a checkbox that was checked and is unchecked again counts as no change', async ({ page }) => {
  const before = await open(page);
  await page.check('#one');
  await page.uncheck('#one');
  const after = await inspect(page, LOCATORS);
  expect(changedControls(before.snapshot, after.snapshot)).toEqual([]);
});

test('a removed control that held a value counts as a change', async ({ page }) => {
  await open(page);
  await page.fill('#t', 'typed');
  const before = await inspect(page, LOCATORS);
  await page.evaluate(() => document.getElementById('t')!.remove());
  const after = await inspect(page, LOCATORS);
  expect(changedControls(before.snapshot, after.snapshot)).toEqual([{ key: 'text#t', before: 'typed', after: '' }]);
});
