// The reader judges every real-page sample, so it gets its own test on a page with one control of each kind.
// Uses no captured sample, so it also runs on a clean clone.
import { expect, test, type Page } from '@playwright/test';
import { changedControls } from '../shared/capturedExpectations';
import { injectHarness } from '../drivers/helpers';
import { inspect, locatorsOf, unjudgedControls } from './readState';

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

test('names every control on the page that has no verdict', async ({ page }) => {
  await page.setContent(`<!doctype html><body>
    <label for="a">Judged</label><input id="a">
    <label for="b">Forgotten</label><input id="b">
    <div role="radiogroup" aria-label="Group"><label><input type="radio" name="r" id="r1">Yes</label><label><input type="radio" name="r" id="r2">No</label></div>
    </body>`);
  await injectHarness(page);
  const missing = await unjudgedControls(page, ['#a', '#r2']);
  expect(missing.map((m) => m.label)).toEqual(['Forgotten']);
  expect(await unjudgedControls(page, ['#a', '#b', '#r1'])).toEqual([]);
});

test('names a verdict whose selector finds nothing', async ({ page }) => {
  await page.setContent('<!doctype html><body><label for="a">A</label><input id="a"></body>');
  await injectHarness(page);
  const missing = await unjudgedControls(page, ['#a', '#gone']);
  expect(missing).toEqual([{ label: 'verdict finds nothing: #gone', kind: '-' }]);
});

// Moka keeps its boxes empty: a list shows its choice beside the input, a multi-select as tags, and a span of
// year and month as four lists side by side.
const mokaList = (id: string, shown = '') =>
  `<label class="sd-Input-container-2S_vM sd-Select-container-1Eq4x"><span class="sd-Input-display-value-RwqDy">${shown}</span><input type="text" id="${id}"></label>`;
const MOKA = `<!doctype html><body>
${mokaList('one-list')}
<label class="sd-Input-container-2S_vM sd-Select-container-1Eq4x multi_select_info"><div><span class="sd-Input-tag-container-1AfzM"><input type="text" id="many"></span></div></label>
<div class="month-range-select date_info">${mokaList('y1')}${mokaList('m1')}${mokaList('y2')}${mokaList('m2')}<label><input type="checkbox" id="still"></label></div>
</body>`;
const MOKA_LOCATORS = { list: '#one-list', many: '#many', span: '.month-range-select input[type=text]' };

test('reads what a Moka list, multi-select and span of months show, not their empty boxes', async ({ page }) => {
  await page.setContent(MOKA);
  const before = await inspect(page, MOKA_LOCATORS);
  expect(before.readings).toEqual({ list: '', many: [], span: '' });
  await page.evaluate(() => {
    const show = (id: string, text: string) => {
      document.getElementById(id)!.closest('label')!.querySelector('[class*="display-value"]')!.textContent = text;
    };
    show('one-list', '硕士');
    for (const [id, text] of [['y1', '2020'], ['m1', '9'], ['y2', '2024'], ['m2', '6']] as const) show(id, text);
    document.querySelector('[class*="tag-container"]')!.insertAdjacentHTML(
      'afterbegin',
      '<span class="sd-Tag-container"><div class="sd-Tag-text-2nFJX">示例甲</div></span><span class="sd-Tag-container"><div class="sd-Tag-text-2nFJX">示例乙</div></span>',
    );
  });
  const after = await inspect(page, MOKA_LOCATORS);
  expect(after.readings).toEqual({ list: '硕士', many: ['示例甲', '示例乙'], span: '2020 9 2024 6' });
  expect(changedControls(before.snapshot, after.snapshot).map((c) => c.key)).toHaveLength(6);
});

test('a verdict that finds two boxes reads the first and covers only it, so a change in the second is caught', async ({ page }) => {
  await page.setContent('<!doctype html><body><div class="entry"><input class="company"></div><div class="entry"><input class="company"></div></body>');
  const locators = { company: '.entry .company' };
  const before = await inspect(page, locators);
  expect(before.coverage.company).toHaveLength(1);
  await page.locator('.company').nth(0).fill('Acme');
  await page.locator('.company').nth(1).fill('Wrong Co');
  const after = await inspect(page, locators);
  expect(after.readings.company).toBe('Acme');
  const covered = new Set(after.coverage.company);
  expect(changedControls(before.snapshot, after.snapshot).filter((c) => !covered.has(c.key))).toEqual([{ key: 'text~1', before: '', after: 'Wrong Co' }]);
});

test('a verdict that names a button and the file box behind it covers both, as parts of one field', async ({ page }) => {
  await page.setContent('<!doctype html><body><div class="upload"><button type="button" class="pick">上传</button><input type="file" id="cv"></div></body>');
  const locators = { resume: '.upload button.pick, #cv' };
  const before = await inspect(page, locators);
  expect(before.coverage.resume).toHaveLength(2);
  await page.setInputFiles('#cv', { name: 'cv.pdf', mimeType: 'application/pdf', buffer: Buffer.from('x') });
  const after = await inspect(page, locators);
  const covered = new Set(after.coverage.resume);
  expect(changedControls(before.snapshot, after.snapshot).filter((c) => !covered.has(c.key))).toEqual([]);
});

test('reads a box with no input behind it once a verdict names it, and sees it change', async ({ page }) => {
  await page.setContent('<!doctype html><body><div id="named" contenteditable="plaintext-only"></div><div id="other" contenteditable="true"></div></body>');
  const locators = { duties: '#named' };
  const before = await inspect(page, locators);
  expect(before.readings.duties).toBe('');
  expect(before.coverage.duties).toHaveLength(1);
  await page.evaluate(() => {
    document.getElementById('named')!.textContent = 'Wrote the tests';
    document.getElementById('other')!.textContent = 'not judged';
  });
  const after = await inspect(page, locators);
  expect(after.readings.duties).toBe('Wrote the tests');
  // Only the named one is a control to the judge: a page's other editable boxes stay out of the comparison.
  expect(changedControls(before.snapshot, after.snapshot)).toHaveLength(1);
});

test('an editable box whose hint is its own text, marked as a placeholder, reads as empty', async ({ page }) => {
  await page.setContent('<!doctype html><body><div class="text_info"><div id="duty" contenteditable="plaintext-only" class="placeholder">内容</div></div></body>');
  expect((await inspect(page, { duties: '#duty' })).readings.duties).toBe('');
});

test('reads boxes that only show an answer as their text, a start and an end as one span', async ({ page }) => {
  await page.setContent('<!doctype html><body><div id="span"><span class="v"></span><span class="v"></span></div><div id="one"><span class="v">2002-03 (24岁)</span></div></body>');
  const expected = {
    __resume: 'zh-CN',
    __knownGapsMax: 0,
    fields: { span: { selector: '#span .v', shown: true as const }, birth: { selector: '#one .v', shown: true as const } },
  };
  const locators = locatorsOf(expected);
  const before = await inspect(page, locators);
  expect(before.readings).toMatchObject({ span: '', birth: '2002-03 (24岁)' });
  expect(before.coverage.span).toHaveLength(2);
  await page.evaluate(() => {
    const [a, b] = document.querySelectorAll('#span .v');
    a!.textContent = '2020-09';
    b!.textContent = '2024-06';
  });
  const after = await inspect(page, locators);
  expect(after.readings.span).toBe('2020-09 ~ 2024-06');
  expect(changedControls(before.snapshot, after.snapshot)).toHaveLength(2);
});
