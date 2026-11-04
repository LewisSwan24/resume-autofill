// The search-and-pick control of one hosted wizard, written out here with made-up choices: a plain input,
// a list that appears when it is clicked, and the choice shown as a pill. Nothing counts until a pill shows.
import { expect, test, type Page } from '@playwright/test';
import { execIntent, injectHarness, type IntentJson } from './helpers';

let page: Page;

test.beforeEach(async ({ page: p }) => {
  page = p;
  await page.goto('/aria/');
  await page.getByLabel('First Name', { exact: true }).waitFor();
  await injectHarness(page);
});

const FORM = `<div data-automation-id="applyFlowPage"><div data-automation-id="formField-source">
  <label for="prompt"><span>Heard from<abbr>*</abbr></span></label>
  <div data-automation-id="multiSelectContainer"><div data-automation-id="multiselectInputContainer"><div>
    <input id="prompt" placeholder="Search" autocomplete="off">
    <div data-automation-id="promptAriaInstruction" style="display:none">0 items selected</div>
  </div><div id="pills"></div></div></div></div>
  <button data-automation-id="pageFooterNextButton" id="next">Save and Continue</button></div>`;

/** `first` shows on opening; `found` shows after typing and pressing Enter. */
async function mount(first: string[], found: string[] = [], opts: { pickSticks?: boolean; chosen?: string; pickOnEnter?: boolean; neverOpens?: boolean } = {}): Promise<void> {
  await page.evaluate(
    ([html, shown, searched, sticks, chosen, pickOnEnter, neverOpens]) => {
      const box = document.createElement('div');
      box.innerHTML = html as string;
      document.body.append(box);
      const w = window as unknown as { nextClicks: number };
      w.nextClicks = 0;
      document.querySelector('#next')!.addEventListener('click', () => {
        w.nextClicks += 1;
      });
      const input = document.querySelector<HTMLInputElement>('#prompt')!;
      const pills = document.querySelector<HTMLElement>('#pills')!;
      const addPill = (text: string): void => {
        pills.insertAdjacentHTML('beforeend', `<div role="option" data-automation-id="selectedItem"><p data-automation-id="promptOption">${text}</p></div>`);
      };
      if (chosen) addPill(chosen as string);
      const close = (): void => document.querySelector('[data-automation-id="activeListContainer"]')?.remove();
      const open = (rows: string[]): void => {
        close();
        const list = document.createElement('div');
        list.setAttribute('data-automation-id', 'activeListContainer');
        list.setAttribute('role', 'listbox');
        for (const row of rows) {
          const item = document.createElement('div');
          item.setAttribute('role', 'option');
          item.setAttribute('data-automation-id', 'menuItem');
          const folder = row.endsWith('>');
          item.innerHTML = `<div data-automation-id="${folder ? 'promptNode' : 'promptLeafNode'}"><div data-automation-id="promptOption">${row.replace('>', '')}</div></div>`;
          if (sticks !== false) {
            item.addEventListener('click', () => {
              addPill(row);
              input.value = '';
            });
          }
          list.append(item);
        }
        document.body.append(list);
      };
      input.addEventListener('click', () => {
        if (!neverOpens) open(shown as string[]);
      });
      input.addEventListener('keydown', (event) => {
        if ((event as KeyboardEvent).key !== 'Enter' || !input.value || neverOpens) return;
        const rows = searched as string[];
        if (pickOnEnter && rows.length === 1) {
          close();
          addPill(rows[0]!);
          input.value = '';
        } else {
          open(rows);
        }
      });
      document.addEventListener('click', (event) => {
        if (neverOpens) return;
        const t = event.target as Element;
        if (t !== input && !t.closest('[data-automation-id="activeListContainer"]')) close();
      });
    },
    [FORM, first, found, opts.pickSticks, opts.chosen, opts.pickOnEnter, opts.neverOpens] as const,
  );
}

const choice = (query: string, matchLabel: string): IntentJson => ({ kind: 'choice', display: matchLabel, query, options: { matchLabel } });
const state = () =>
  page.evaluate(() => ({
    pills: [...document.querySelectorAll('[data-automation-id="selectedItem"]')].map((p) => p.textContent),
    typed: document.querySelector<HTMLInputElement>('#prompt')!.value,
    open: !!document.querySelector('[data-automation-id="activeListContainer"]'),
    next: (window as unknown as { nextClicks: number }).nextClicks,
  }));

test('is discovered as a pick list, not a text box', async () => {
  await mount(['Website']);
  const located = await page.evaluate(() => window.__raf.locate('Heard from'));
  expect(located).toMatchObject({ kind: 'select', lib: 'workday' });
});

test('picks from the list that opens', async () => {
  await mount(['Advertisement', 'Website']);
  const report = await execIntent(page, 'Heard from', choice('Website', 'Website'));
  expect(report.outcome).toBe('filled');
  expect(report.observed).toBe('Website');
  expect(await state()).toEqual({ pills: ['Website'], typed: '', open: false, next: 0 });
});

test('searches when the list that opens does not have it', async () => {
  await mount(['Advertisement'], ['Website']);
  const report = await execIntent(page, 'Heard from', choice('Website', 'Website'));
  expect(report.outcome).toBe('filled');
  expect((await state()).pills).toEqual(['Website']);
});

test('nothing fitting leaves no text behind and no list open', async () => {
  await mount(['Advertisement'], ['Elsewhere']);
  const report = await execIntent(page, 'Heard from', choice('Website', 'Website'));
  expect(report.outcome).toBe('no_option');
  expect(await state()).toEqual({ pills: [], typed: '', open: false, next: 0 });
});

test('a folder in the list is not an answer', async () => {
  await mount(['Website>']);
  const report = await execIntent(page, 'Heard from', choice('Website', 'Website'));
  expect(report.outcome).toBe('no_option');
  expect((await state()).pills).toEqual([]);
});

test('text in the box is not an answer until a pill shows', async () => {
  await mount(['Website'], [], { pickSticks: false });
  const report = await execIntent(page, 'Heard from', choice('Website', 'Website'));
  expect(report.outcome).toBe('action_failed');
  expect(await state()).toMatchObject({ pills: [], typed: '', open: false });
});

test('the choice already there is left alone', async () => {
  await mount(['Website'], [], { chosen: 'Website' });
  const report = await execIntent(page, 'Heard from', choice('Website', 'Website'));
  expect(report.outcome).toBe('filled');
  expect((await state()).pills).toEqual(['Website']);
});

test('a different choice already there is not added to or replaced', async () => {
  await mount(['Website'], [], { chosen: 'Advertisement' });
  const report = await execIntent(page, 'Heard from', choice('Website', 'Website'));
  expect(report.outcome).toBe('needs_review');
  expect(await state()).toMatchObject({ pills: ['Advertisement'], open: false, next: 0 });
});

test('the list of the field before, still closing, is not read', async () => {
  await mount([], [], { neverOpens: true });
  await page.evaluate(() => {
    const input = document.querySelector<HTMLInputElement>('#prompt')!;
    const stray = document.createElement('div');
    stray.setAttribute('data-automation-id', 'activeListContainer');
    stray.setAttribute('role', 'listbox');
    stray.innerHTML = '<div role="option" data-automation-id="menuItem"><div data-automation-id="promptLeafNode"><div data-automation-id="promptOption">Website</div></div></div>';
    const w = window as unknown as { strayClicks: number };
    w.strayClicks = 0;
    stray.addEventListener('click', () => {
      w.strayClicks += 1;
    });
    document.body.append(stray);
    setTimeout(() => stray.remove(), 300);
    // The real list of this field comes only after that one has gone.
    input.addEventListener('click', () => {
      const wait = setInterval(() => {
        if (document.querySelector('[data-automation-id="activeListContainer"]')) return;
        clearInterval(wait);
        const own = document.createElement('div');
        own.setAttribute('data-automation-id', 'activeListContainer');
        own.setAttribute('role', 'listbox');
        own.innerHTML = '<div role="option" data-automation-id="menuItem"><div data-automation-id="promptLeafNode"><div data-automation-id="promptOption">Website</div></div></div>';
        own.addEventListener('click', () => {
          document.querySelector('#pills')!.insertAdjacentHTML('beforeend', '<div role="option" data-automation-id="selectedItem"><p data-automation-id="promptOption">Website</p></div>');
        });
        document.body.append(own);
      }, 20);
    });
  });
  const report = await execIntent(page, 'Heard from', choice('Website', 'Website'));
  expect(report.outcome).toBe('filled');
  expect(await page.evaluate(() => (window as unknown as { strayClicks: number }).strayClicks)).toBe(0);
  expect((await state()).pills).toEqual(['Website']);
});

test('a list that stays open from elsewhere stops it, and nothing is picked from it', async () => {
  await mount([], [], { neverOpens: true });
  await page.evaluate(() => {
    const stray = document.createElement('div');
    stray.setAttribute('data-automation-id', 'activeListContainer');
    stray.setAttribute('role', 'listbox');
    stray.innerHTML = '<div role="option" data-automation-id="menuItem"><div data-automation-id="promptLeafNode"><div data-automation-id="promptOption">Website</div></div></div>';
    stray.id = 'stuck';
    const w = window as unknown as { stuckClicks: number };
    w.stuckClicks = 0;
    stray.addEventListener('click', () => {
      w.stuckClicks += 1;
    });
    document.body.append(stray);
  });
  const report = await execIntent(page, 'Heard from', choice('Website', 'Website'));
  expect(report.outcome).toBe('action_failed');
  expect(await page.evaluate(() => (window as unknown as { stuckClicks: number }).stuckClicks)).toBe(0);
  expect((await state()).pills).toEqual([]);
});

test('a list that never opens is not reported as the site lacking the answer', async () => {
  await mount(['Website'], ['Website'], { neverOpens: true });
  const report = await execIntent(page, 'Heard from', choice('Website', 'Website'));
  expect(report.outcome).toBe('action_failed');
  expect(await state()).toMatchObject({ pills: [], typed: '', next: 0 });
});

test('the page picking the one result by itself counts when it is the answer', async () => {
  await mount([], ['Website'], { pickOnEnter: true });
  const report = await execIntent(page, 'Heard from', choice('Website', 'Website'));
  expect(report.outcome).toBe('filled');
  expect(await state()).toMatchObject({ pills: ['Website'], typed: '', open: false });
});

test('the page picking something else by itself goes to the user', async () => {
  await mount([], ['Webinar'], { pickOnEnter: true });
  const report = await execIntent(page, 'Heard from', choice('Website', 'Website'));
  expect(report.outcome).toBe('needs_review');
  expect(report.observed).toBe('Webinar');
});
