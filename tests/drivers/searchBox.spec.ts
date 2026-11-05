// Search boxes with no ARIA roles and forms that read an upload: the behaviour of one hosted form,
// written out here with made-up places. Runs on the aria fixture page, which has none of this markup.
import { expect, test, type Page } from '@playwright/test';
import { execIntent, injectHarness, type IntentJson } from './helpers';

let page: Page;

test.beforeEach(async ({ page: p }) => {
  page = p;
  await page.goto('/aria/');
  await page.getByLabel('First Name', { exact: true }).waitFor();
  await injectHarness(page);
});

const FORM = `<form id="hosted"><ul>
  <li class="application-question"><label><div class="application-label">Full name</div>
    <div class="application-field"><input name="name" type="text"></div></label></li>
  <li class="application-question"><label><div class="application-label">Email</div>
    <div class="application-field"><input name="email" type="email"></div></label></li>
  <li class="application-question"><label><div class="application-label">Resume</div>
    <div class="application-field"><input id="resume-upload-input" name="resume" type="file">
    <div class="resume-upload-working" style="display:none">One moment</div></div></label></li>
  <li class="application-question"><label><div class="application-label">Home town</div>
    <div class="application-field"><input class="location-input" id="location-input" name="location" type="text">
    <input id="selected-location" type="hidden" name="selectedLocation">
    <div class="dropdown-container" style="display:none"><div class="dropdown-results"></div></div></div></label></li>
</ul></form>`;

/** Results come after a pause, and only once a key is pressed. Leaving the box while the list is up empties it. */
async function mount(results: string[], opts: { pickSticks?: boolean } = {}): Promise<void> {
  await page.evaluate(
    ([html, places, sticks]) => {
      const box = document.createElement('div');
      box.innerHTML = html as string;
      document.body.append(box);
      const input = document.querySelector<HTMLInputElement>('#location-input')!;
      const hidden = document.querySelector<HTMLInputElement>('#selected-location')!;
      const panel = document.querySelector<HTMLElement>('.dropdown-container')!;
      const list = document.querySelector<HTMLElement>('.dropdown-results')!;
      let timer = 0;
      input.addEventListener('input', () => {
        panel.style.display = 'flex';
      });
      input.addEventListener('keydown', () => {
        clearTimeout(timer);
        timer = window.setTimeout(() => {
          list.innerHTML = '';
          if (!input.value) return;
          (places as string[]).forEach((place, i) => {
            const row = document.createElement('div');
            row.className = 'dropdown-location';
            row.id = `location-${i}`;
            row.textContent = place;
            list.append(row);
          });
        }, 120);
      });
      input.addEventListener('blur', () => {
        if (panel.style.display === 'none') return;
        panel.style.display = 'none';
        list.innerHTML = '';
        input.value = '';
        hidden.value = '';
      });
      if (sticks !== false) {
        document.addEventListener('mousedown', (event) => {
          const row = (event.target as Element).closest('.dropdown-location');
          if (!row) return;
          panel.style.display = 'none';
          input.value = row.textContent ?? '';
          hidden.value = JSON.stringify({ name: row.textContent });
          list.innerHTML = '';
        });
      }
    },
    [FORM, results, opts.pickSticks] as const,
  );
}

const choice = (query: string, matchLabel: string): IntentJson => ({
  kind: 'choice',
  display: matchLabel,
  query,
  options: { matchLabel },
});

const state = () =>
  page.evaluate(() => ({
    shown: document.querySelector<HTMLInputElement>('#location-input')!.value,
    kept: document.querySelector<HTMLInputElement>('#selected-location')!.value,
    open: document.querySelector<HTMLElement>('.dropdown-container')!.style.display !== 'none',
  }));

test('picks the result, and the page keeps it after leaving the box', async () => {
  await mount(['Springfield, Vic, Testland', 'Springfield, NSW, Testland']);
  const report = await execIntent(page, 'Home town', choice('Springfield', 'Springfield, Vic, Testland'));
  expect(report.outcome).toBe('filled');
  expect(report.observed).toBe('Springfield, Vic, Testland');
  expect(await state()).toEqual({
    shown: 'Springfield, Vic, Testland',
    kept: JSON.stringify({ name: 'Springfield, Vic, Testland' }),
    open: false,
  });
});

test('a search with nothing fitting leaves the box as it was', async () => {
  await mount(['Elsewhere, Testland']);
  const report = await execIntent(page, 'Home town', choice('Springfield', 'Springfield, Vic, Testland'));
  expect(report.outcome).toBe('no_option');
  expect(await state()).toEqual({ shown: '', kept: '', open: false });
});

test('text in the box does not count until the page has taken a result', async () => {
  await mount(['Springfield, Vic, Testland'], { pickSticks: false });
  const report = await execIntent(page, 'Home town', choice('Springfield', 'Springfield, Vic, Testland'));
  expect(report.outcome).toBe('action_failed');
  expect((await state()).kept).toBe('');
});

test('a box that already holds the choice is left alone', async () => {
  await mount(['Springfield, Vic, Testland']);
  await page.evaluate(() => {
    document.querySelector<HTMLInputElement>('#location-input')!.value = 'Springfield, Vic, Testland';
    document.querySelector<HTMLInputElement>('#selected-location')!.value = '{"name":"Springfield, Vic, Testland","id":"kept"}';
  });
  const report = await execIntent(page, 'Home town', choice('Springfield', 'Springfield, Vic, Testland'));
  expect(report.outcome).toBe('filled');
  expect((await state()).kept).toBe('{"name":"Springfield, Vic, Testland","id":"kept"}');
});

test('text in the box is not enough when the page has kept a different place', async () => {
  await mount(['Springfield, Vic, Testland']);
  await page.evaluate(() => {
    document.querySelector<HTMLInputElement>('#location-input')!.value = 'Springfield, Vic, Testland';
    document.querySelector<HTMLInputElement>('#selected-location')!.value = '{"name":"Elsewhere, Testland"}';
  });
  const report = await execIntent(page, 'Home town', choice('Springfield', 'Springfield, Vic, Testland'));
  expect(report.outcome).toBe('filled');
  expect((await state()).kept).toBe(JSON.stringify({ name: 'Springfield, Vic, Testland' }));
});

for (const [name, results, outcome] of [
  ['finds nothing that fits', ['Elsewhere, Testland'], 'no_option'],
  ['cannot choose between two', ['Springfield, Vic, Testland', 'Springfield, Vic, Testland'], 'needs_review'],
] as const) {
  test(`a place already picked stays when a new search ${name}`, async () => {
    await mount([...results]);
    await page.evaluate(() => {
      document.querySelector<HTMLInputElement>('#location-input')!.value = 'Oldtown, Testland';
      document.querySelector<HTMLInputElement>('#selected-location')!.value = '{"name":"Oldtown, Testland"}';
    });
    const report = await execIntent(page, 'Home town', choice('Springfield', 'Springfield, Vic, Testland'));
    expect(report.outcome).toBe(outcome);
    expect(await state()).toEqual({ shown: 'Oldtown, Testland', kept: '{"name":"Oldtown, Testland"}', open: false });
  });
}

for (const showsAfter of [0, 100]) {
test(`waits for the page to finish reading an upload, with the sign showing after ${showsAfter} ms`, async () => {
  // The fixture's own form has an upload box too, and one resume goes to one box.
  await page.evaluate(() => document.querySelector('#root')?.remove());
  await mount([]);
  // The page reads the file for a while, then writes over every field: the worst case.
  await page.evaluate((after) => {
    const busy = document.querySelector<HTMLElement>('.resume-upload-working')!;
    document.querySelector('#resume-upload-input')!.addEventListener('change', () => {
      const show = () => {
        busy.style.display = 'block';
      };
      if (after) setTimeout(show, after);
      else show();
      setTimeout(() => {
        busy.style.display = 'none';
        document.querySelector<HTMLInputElement>('input[name=name]')!.value = 'Parsed Name';
        document.querySelector<HTMLInputElement>('input[name=email]')!.value = 'parsed@example.test';
      }, 700);
    });
  }, showsAfter);
  const seen = await page.evaluate(async () => {
    const raf = window.__raf;
    const resume = raf.samples.resumes.find((r) => r.locale === 'en-AU')!;
    const run = await raf.runFill(document, { resume, files: raf.sampleFiles });
    // Long enough for the page to have written, had it not finished before the fill.
    await new Promise((resolve) => setTimeout(resolve, 900));
    return {
      name: document.querySelector<HTMLInputElement>('input[name=name]')!.value,
      email: document.querySelector<HTMLInputElement>('input[name=email]')!.value,
      file: document.querySelector<HTMLInputElement>('#resume-upload-input')!.files?.length ?? 0,
      rows: run.report.fields.filter((f) => /resume|name|email/i.test(f.label)).map((f) => `${f.label}: ${f.outcome} ${f.fieldKey ?? ''}`),
    };
  });
  expect(seen.file, seen.rows.join(' | ')).toBe(1);
  expect(seen.name).not.toBe('Parsed Name');
  expect(seen.email).not.toBe('parsed@example.test');
});
}

test('waits too when the user uploaded by hand just before filling', async () => {
  await page.evaluate(() => document.querySelector('#root')?.remove());
  await mount([]);
  const seen = await page.evaluate(async () => {
    const busy = document.querySelector<HTMLElement>('.resume-upload-working')!;
    busy.style.display = 'block';
    setTimeout(() => {
      busy.style.display = 'none';
      document.querySelector<HTMLInputElement>('input[name=name]')!.value = 'Parsed Name';
    }, 500);
    const raf = window.__raf;
    const resume = raf.samples.resumes.find((r) => r.locale === 'en-AU')!;
    await raf.runFill(document, { resume, files: {} });
    await new Promise((resolve) => setTimeout(resolve, 700));
    return document.querySelector<HTMLInputElement>('input[name=name]')!.value;
  });
  expect(seen).not.toBe('Parsed Name');
});

/**
 * A code box as one hosted form builds it: the list shows a few rows around the current choice, typing narrows it,
 * and taking a row swaps the input for a new element under a new id.
 */
async function mountCodeBox(): Promise<void> {
  await page.evaluate(() => {
    const ROWS = ['+1 US - United States', '+1 CA - Canada', '+61 AU - Australia', '+61 CX - Christmas Island', '+64 NZ - New Zealand'];
    const form = document.createElement('form');
    form.innerHTML = `<div id="code-row"><label for="other-box">Nickname</label><input id="other-box" type="text">
      <div id="code-slot"></div><label for="phone-box">Phone number</label><input id="phone-box" type="text"></div>`;
    document.body.append(form);
    const slot = form.querySelector<HTMLElement>('#code-slot')!;
    let serial = 30;
    const build = (value: string): void => {
      slot.innerHTML = '';
      const id = `field-${serial++}`;
      const input = document.createElement('input');
      input.id = id;
      input.type = 'text';
      input.value = value;
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-haspopup', 'listbox');
      input.setAttribute('aria-autocomplete', 'list');
      input.setAttribute('aria-expanded', 'false');
      input.setAttribute('aria-label', 'Code search');
      slot.append(input);
      const show = (rows: string[]): void => {
        slot.querySelector('[role=listbox]')?.remove();
        const list = document.createElement('ul');
        list.id = `${id}-list`;
        list.setAttribute('role', 'listbox');
        for (const text of rows) {
          const row = document.createElement('li');
          row.setAttribute('role', 'option');
          row.textContent = text;
          row.addEventListener('click', () => build(text.split(' - ')[0]!));
          list.append(row);
        }
        slot.append(list);
        input.setAttribute('aria-controls', list.id);
        input.setAttribute('aria-expanded', 'true');
      };
      input.addEventListener('click', () => show(ROWS.slice(0, 2)));
      input.addEventListener('input', () => show(ROWS.filter((r) => r.includes(input.value))));
    };
    build('+1 US');
  });
}

test('follows a search box that the page replaces under a new id when a row is taken', async () => {
  await mountCodeBox();
  const report = await execIntent(page, 'Code search', {
    kind: 'choice',
    display: '+61',
    query: '+61',
    options: { matchLabel: '+61 AU - Australia' },
  });
  expect(report).toMatchObject({ outcome: 'filled', observed: '+61 AU' });
  expect(await page.locator('#code-slot input').inputValue()).toBe('+61 AU');
});

/** A plain button with a prompt: the list shows up as menu items, and the button then says the choice. */
async function mountPromptButton(listRole: string | null = 'menu'): Promise<void> {
  await page.evaluate((role) => {
    const form = document.createElement('form');
    form.innerHTML = '<div id="gender-row"><div>Gender</div><button type="button" id="pick"><div>Please select<i><svg viewBox="0 0 24 24"><path d="M1 1"></path></svg></i></div></button></div>';
    document.body.append(form);
    const button = form.querySelector<HTMLButtonElement>('#pick')!;
    button.addEventListener('click', () => {
      if (document.querySelector('#gender-menu')) {
        document.querySelector('#gender-menu')!.remove();
        return;
      }
      const list = document.createElement('ul');
      list.id = 'gender-menu';
      if (role) list.setAttribute('role', role);
      for (const text of ['Male', 'Female', 'Decline to self-identify']) {
        const row = document.createElement('li');
        row.setAttribute('role', 'menuitem');
        row.textContent = text;
        row.addEventListener('click', () => {
          button.querySelector('div')!.textContent = text;
          list.remove();
        });
        list.append(row);
      }
      form.append(list);
    });
  }, listRole);
}

test('a plain button with a prompt: picks from the menu it opens', async () => {
  await mountPromptButton();
  const report = await execIntent(page, 'Gender', choice('Female', 'Female'));
  expect(report).toMatchObject({ outcome: 'filled', observed: 'Female' });
  await expect(page.locator('#gender-menu')).toHaveCount(0);
});

test('a plain button with a prompt: no match closes the menu and leaves the prompt', async () => {
  await mountPromptButton();
  const report = await execIntent(page, 'Gender', choice('Nonbinary', 'Nonbinary'));
  expect(report.outcome).toBe('no_option');
  await expect(page.locator('#gender-menu')).toHaveCount(0);
  await expect(page.locator('#pick')).toHaveText('Please select');
});

test('a plain button with a prompt: menu items in a list that has no role of its own', async () => {
  await mountPromptButton(null);
  const report = await execIntent(page, 'Gender', choice('Female', 'Female'));
  expect(report).toMatchObject({ outcome: 'filled', observed: 'Female' });
});
