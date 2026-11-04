// A section filled one entry at a time: Add opens an editor, Update closes it into a list above the
// others. Written out here with made-up data; the behaviour comes from one hosted form. The dates are
// masked the way that form masks them: a change with no key pressed first throws and is lost.
import { expect, test, type Page } from '@playwright/test';
import { execIntent, injectHarness } from './helpers';

const PAGE = `<!doctype html><html><body><div data-ui="careers-page-content"><form id="f">
  <div data-ui="education"><div><p id="education_label">Education <small>(Optional)</small></p>
    <button data-ui="add-section" aria-label="Add Education" type="button">+ Add</button></div><ul></ul></div>
  <div data-ui="experience"><div><p id="experience_label">Experience <small>(Optional)</small></p>
    <button data-ui="add-section" aria-label="Add Experience" type="button">+ Add</button></div><ul></ul></div>
  <button type="submit" id="submit">Submit application</button>
</form></div>
<script>
  window.__entries = { education: [], experience: [] };
  window.__submits = 0;
  window.__submitClicks = 0;
  document.getElementById('submit').addEventListener('click', () => { window.__submitClicks += 1; });
  document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); window.__submits += 1; });

  const FIELDS = {
    education: [['school', 'School', 'text', true], ['field_of_study', 'Field of study', 'text'], ['degree', 'Degree', 'text'],
      ['start_date', 'Start date', 'date'], ['end_date', 'End date', 'date']],
    experience: [['title', 'Title', 'text', true], ['company', 'Company', 'text'], ['industry', 'Industry', 'text'],
      ['summary', 'Summary', 'area'], ['start_date', 'Start date', 'date'], ['end_date', 'End date', 'date'], ['current', 'I currently work here', 'check']],
  };

  function masked(input) {
    let last;
    input.addEventListener('keydown', () => { last = input.value; });
    input.addEventListener('input', () => {
      if (last === undefined) { input.value = ''; throw new TypeError('read of undefined (slice)'); }
      last.slice(-1);
    });
  }

  function open(name) {
    const root = document.querySelector('[data-ui="' + name + '"]');
    const add = root.querySelector('[data-ui="add-section"]');
    add.disabled = true;
    const li = document.createElement('li');
    const editor = document.createElement('div');
    editor.dataset.ui = 'editor';
    for (const [id, text, kind, required] of FIELDS[name]) {
      const label = document.createElement('label');
      const caption = document.createElement('span');
      caption.textContent = text + (required || kind === 'check' ? '' : ' (Optional)');
      label.append(caption);
      const input = document.createElement(kind === 'area' ? 'textarea' : 'input');
      input.name = id;
      if (kind === 'check') input.type = 'checkbox';
      else if (kind !== 'area') input.type = 'text';
      if (kind === 'date') { input.placeholder = 'MM/YYYY'; masked(input); }
      if (required) input.required = true;
      label.append(input);
      editor.append(label);
    }
    const save = document.createElement('button');
    save.type = 'button'; save.dataset.ui = 'save-section'; save.textContent = 'Update';
    const cancel = document.createElement('button');
    cancel.type = 'button'; cancel.dataset.ui = 'cancel-section'; cancel.textContent = 'Cancel';
    editor.append(save, cancel);
    li.append(editor);
    const list = root.querySelector('ul');
    list.prepend(li);
    const close = () => { li.remove(); add.disabled = false; };
    cancel.addEventListener('click', close);
    save.addEventListener('click', () => {
      const missing = editor.querySelector('input[required]');
      if (missing && !missing.value) {
        const error = document.createElement('span');
        error.textContent = 'This is a required field.';
        editor.append(error);
        return;
      }
      const entry = {};
      for (const [id] of FIELDS[name]) {
        const input = editor.querySelector('[name="' + id + '"]');
        entry[id] = input.type === 'checkbox' ? input.checked : input.value;
      }
      window.__entries[name].unshift(entry);
      close();
      const item = document.createElement('li');
      const group = document.createElement('div');
      group.dataset.ui = 'group';
      group.innerHTML = '<dl></dl>';
      for (const [id, text] of FIELDS[name]) {
        if (!entry[id] || entry[id] === true) continue;
        const dt = document.createElement('dt'); dt.textContent = text;
        const dd = document.createElement('dd'); dd.dataset.ui = id; dd.textContent = entry[id];
        group.firstChild.append(dt, dd);
      }
      item.append(group);
      list.prepend(item);
    });
  }
  for (const name of Object.keys(FIELDS)) {
    document.querySelector('[data-ui="' + name + '"] [data-ui="add-section"]').addEventListener('click', () => open(name));
  }
</script></body></html>`;

interface Row {
  outcome: string;
  fieldId: string;
  fieldKey: string | null;
  label: string;
}
interface Result {
  rows: Row[];
  entries: Record<string, Record<string, string | boolean>[]>;
}

declare global {
  interface Window {
    __entries: Result['entries'];
    __submits: number;
    __submitClicks: number;
  }
}

let page: Page;
let errors: string[];

test.beforeEach(async ({ page: p }) => {
  page = p;
  errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.setContent(PAGE);
  await injectHarness(page);
});

test.afterEach(async () => {
  // Whatever else a test is about, the application itself is never sent.
  expect(await page.evaluate(() => [window.__submits, window.__submitClicks])).toEqual([0, 0]);
});

type Patch = { education?: Record<string, unknown>[]; work?: Record<string, unknown>[] };

function fill(patch: Patch, runs = 1): Promise<Result> {
  return page.evaluate(
    async ({ patch, runs }) => {
      const raf = window.__raf;
      const sample = structuredClone(raf.samples.resumes.find((r) => r.locale === 'en-AU')!);
      const resume = {
        ...sample,
        education: (patch.education ?? []).map((e) => ({ ...sample.education[0]!, ...e })),
        work: (patch.work ?? []).map((e) => ({ ...sample.work[0]!, ...e })),
      };
      let rows: Row[] = [];
      for (let i = 0; i < runs; i += 1) rows = (await raf.runFill(document, { resume, files: {} })).report.fields;
      return { rows, entries: window.__entries };
    },
    { patch, runs },
  );
}

const DEGREES = [
  { school: 'Later University', major: 'Data Science', degree: 'master', startDate: '2023-02', endDate: '2024-11' },
  { school: 'Earlier University', major: 'Mathematics', degree: 'bachelor', startDate: '2019-02', endDate: '2022-11' },
];
const JOBS = [
  { company: 'Now Pty Ltd', position: 'Analyst', startDate: '2024-03', endDate: '', current: true, description: 'Reads data.' },
  { company: 'Then Pty Ltd', position: 'Intern', startDate: '2022-01', endDate: '2023-12', current: false, description: 'Learned.' },
];

test('fills every entry, keeping the order of the resume on the page', async () => {
  const { entries } = await fill({ education: DEGREES, work: JOBS });
  expect(entries.education).toEqual([
    { school: 'Later University', field_of_study: 'Data Science', degree: 'Master', start_date: '02/2023', end_date: '11/2024' },
    { school: 'Earlier University', field_of_study: 'Mathematics', degree: 'Bachelor', start_date: '02/2019', end_date: '11/2022' },
  ]);
  expect(entries.experience).toEqual([
    { title: 'Analyst', company: 'Now Pty Ltd', industry: '', summary: 'Reads data.', start_date: '03/2024', end_date: '', current: true },
    { title: 'Intern', company: 'Then Pty Ltd', industry: '', summary: 'Learned.', start_date: '01/2022', end_date: '12/2023', current: false },
  ]);
});

test('does not make a masked date field throw', async () => {
  await fill({ education: DEGREES });
  expect(errors).toEqual([]);
});

test('reports the fields of every entry as filled', async () => {
  const { rows } = await fill({ education: DEGREES });
  const schools = rows.filter((r) => r.fieldKey === 'education.school');
  expect(schools.map((r) => r.outcome)).toEqual(['filled', 'filled']);
  expect(rows.filter((r) => r.outcome === 'action_failed')).toEqual([]);
});

test('adds nothing when run again', async () => {
  const { entries } = await fill({ education: DEGREES, work: JOBS }, 2);
  expect(entries.education).toHaveLength(2);
  expect(entries.experience).toHaveLength(2);
});

test('adds two degrees from one school, and neither again when run twice', async () => {
  const same = [{ ...DEGREES[0], school: 'Same University' }, { ...DEGREES[1], school: 'Same University' }];
  const { entries } = await fill({ education: same }, 2);
  expect(entries.education?.map((e) => e.degree)).toEqual(['Master', 'Bachelor']);
});

test('stops at an entry the page refuses, leaving it open and saying so', async () => {
  const { entries, rows } = await fill({ work: [JOBS[0]!, { ...JOBS[1], position: '' }] });
  // The later entry goes first, because the page puts each new one on top. It has no title, so Update refuses it.
  expect(entries.experience).toEqual([]);
  expect(await page.locator('[data-ui="experience"] [data-ui="editor"]').count()).toBe(1);
  expect(await page.locator('[data-ui="experience"] input[name=company]').inputValue()).toBe('Then Pty Ltd');
  expect(rows.find((r) => r.fieldId === 'section:work')?.outcome).toBe('action_failed');
});

test('leaves an editor the user has open alone', async () => {
  await page.locator('[data-ui="education"] [data-ui="add-section"]').click();
  await page.locator('input[name=school]').fill('Typed by hand');
  const { entries, rows } = await fill({ education: DEGREES });
  expect(await page.locator('input[name=school]').inputValue()).toBe('Typed by hand');
  expect(await page.locator('input[name=field_of_study]').inputValue()).toBe('');
  expect(entries.education).toEqual([]);
  expect(rows.find((r) => r.fieldId === 'section:education')?.outcome).toBe('action_failed');
});

test('opens nothing for a section the resume has no entries for', async () => {
  await fill({ work: [JOBS[0]!] });
  expect(await page.locator('[data-ui="education"] li').count()).toBe(0);
});

test('never fills the industry of a past job from the industry wanted next', async () => {
  const { rows } = await fill({ work: [JOBS[0]!] });
  expect(rows.filter((r) => r.label.startsWith('Industry'))).toEqual([]);
});

// A phone box from intl-tel-input: the country sits in a list beside it, and the box keeps the rest.
const phonePage = (follows: boolean) => `<!doctype html><html><body><div data-ui="careers-page-content"><form>
  <label for="input_phone">Phone</label>
  <div class="iti"><ul>
    <li class="iti__country" role="option" aria-selected="true" data-dial-code="61">Australia</li>
    <li class="iti__country" role="option" aria-selected="false" data-dial-code="86">China</li>
  </ul><input id="input_phone" name="phone" type="tel" data-intl-tel-input-id="0" /></div>
</form></div>
<script>
  const input = document.getElementById('input_phone');
  input.addEventListener('input', () => {
    const m = /^\\+(61|86)\\s*(.*)$/.exec(input.value);
    if (!m) return;
    if (${follows}) for (const li of document.querySelectorAll('.iti__country')) li.setAttribute('aria-selected', String(li.dataset.dialCode === m[1]));
    input.value = m[2];
  });
</script></body></html>`;

function fillPhone(code: string, phone: string): Promise<{ outcome: string | undefined; value: string }> {
  return page.evaluate(
    async ({ code, phone }) => {
      const raf = window.__raf;
      const resume = structuredClone(raf.samples.resumes.find((r) => r.locale === 'en-AU')!);
      resume.contact.phoneCountryCode = code;
      resume.contact.phone = phone;
      const run = await raf.runFill(document, { resume, files: {} });
      const row = run.report.fields.find((f) => f.fieldKey === 'contact.phoneFull');
      return { outcome: row?.outcome, value: document.querySelector<HTMLInputElement>('input[name=phone]')!.value };
    },
    { code, phone },
  );
}

test('reads a phone number together with the country shown beside it', async () => {
  await page.setContent(phonePage(true));
  await injectHarness(page);
  expect(await fillPhone('+86', '13800138000')).toEqual({ outcome: 'filled', value: '13800138000' });
});

test('says so when the country beside a phone number did not follow it', async () => {
  await page.setContent(phonePage(false));
  await injectHarness(page);
  expect((await fillPhone('+86', '13800138000')).outcome).toBe('action_failed');
});

test('adds the degree that is missing when another from the same school is saved', async () => {
  const [master, bachelor] = [{ ...DEGREES[0], school: 'Same University' }, { ...DEGREES[1], school: 'Same University' }];
  await fill({ education: [bachelor] });
  const { entries } = await fill({ education: [master, bachelor] });
  expect(entries.education?.map((e) => e.degree)).toEqual(['Master', 'Bachelor']);
});

test('does not take a company whose name is inside another for the same one', async () => {
  await fill({ work: [{ ...JOBS[0], company: 'Metacore', position: 'Analyst' }] });
  const { entries } = await fill({ work: [{ ...JOBS[0], company: 'Meta', position: 'Analyst' }] });
  expect(entries.experience?.map((e) => e.company)).toEqual(['Meta', 'Metacore']);
});

test('does not take a job for one its description happens to mention', async () => {
  await fill({ work: [{ ...JOBS[1], company: 'Acme', position: 'Engineer', description: 'Worked with Google every day.' }] });
  const { entries } = await fill({ work: [{ ...JOBS[0], company: 'Google', position: 'Engineer' }] });
  expect(entries.experience?.map((e) => e.company)).toEqual(['Google', 'Acme']);
});

test('does not save an entry when one of its fields would not take a value', async () => {
  await page.evaluate(() => {
    document.addEventListener('input', (e) => {
      const el = e.target as HTMLInputElement;
      if (el.name === 'company') el.value = '';
    });
  });
  const { entries, rows } = await fill({ work: [JOBS[0]!] });
  expect(entries.experience).toEqual([]);
  expect(await page.locator('[data-ui="experience"] [data-ui="editor"]').count()).toBe(1);
  expect(await page.locator('[data-ui="experience"] input[name=title]').inputValue()).toBe('Analyst');
  expect(rows.find((r) => r.fieldId === 'section:work')?.outcome).toBe('action_failed');
});

test('says so when an entry has data but nothing to name it by', async () => {
  const { entries, rows } = await fill({ work: [{ ...JOBS[0], company: '', position: '' }] });
  expect(entries.experience).toEqual([]);
  expect(rows.find((r) => r.fieldId === 'section:work')?.outcome).toBe('action_failed');
  expect(await page.locator('[data-ui="experience"] [data-ui="editor"]').count()).toBe(0);
});

test('passes over an entry with nothing in it', async () => {
  const blank = { company: '', position: '', description: '', startDate: '', endDate: '', current: false };
  const { entries, rows } = await fill({ work: [{ ...JOBS[0], ...blank }, JOBS[1]!] });
  expect(entries.experience?.map((e) => e.company)).toEqual(['Then Pty Ltd']);
  expect(rows.filter((r) => r.fieldId === 'section:work')).toEqual([]);
});

test('on a page with no adapter, a phone box beside a country list reads as the number it holds', async () => {
  await page.setContent(`<!doctype html><html><body><form>
    <label for="input_phone">Phone</label>
    <div class="iti"><ul><li class="iti__country" role="option" aria-selected="true" data-dial-code="61">Australia</li></ul>
    <input id="input_phone" name="phone" type="tel" /></div>
  </form></body></html>`);
  await injectHarness(page);
  const result = await execIntent(page, 'Phone', { kind: 'text', text: '0412345678' });
  expect(result.outcome).toBe('filled');
});

