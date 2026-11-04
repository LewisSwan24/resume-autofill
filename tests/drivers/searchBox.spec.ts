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
