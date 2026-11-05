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

/** Add plain markup to the page; widgets below wire it up with `page.evaluate`. */
const add = (html: string) =>
  page.evaluate((h) => {
    const box = document.createElement('div');
    box.innerHTML = h;
    document.body.append(box);
  }, html);

test('a click that does nothing is not a fill, even when the old value looks like the new one', async () => {
  await add(`<label for="g">Gender</label>
    <div class="x__control"><span class="x__single-value">Male</span><input id="g" role="combobox" aria-controls="g-list"></div>
    <ul id="g-list" role="listbox" hidden><li role="option">Male</li><li role="option">Female</li></ul>`);
  await page.evaluate(() => {
    document.getElementById('g')!.addEventListener('mousedown', () => document.getElementById('g-list')!.removeAttribute('hidden'));
  });
  const r = await execIntent(page, 'Gender', choice('Female'));
  expect(r.outcome).toBe('action_failed');
  expect(r.observed).toBe('Male');
});

test('typed text that equals the option is not a fill while the click did nothing', async () => {
  await add(`<label for="t">Town</label><input id="t" role="combobox" aria-controls="t-list">
    <ul id="t-list" role="listbox" style="margin:0;padding:0"></ul>`);
  await page.evaluate(() => {
    document.getElementById('t')!.addEventListener('input', () => {
      document.getElementById('t-list')!.innerHTML = '<li role="option">Brisbane</li>';
    });
  });
  const r = await execIntent(page, 'Town', choice('Brisbane'));
  expect(r.outcome).toBe('action_failed');
  await expect(page.locator('#t')).toHaveValue('');
});

test('a value the widget takes back on leaving the field is not a fill', async () => {
  await add(`<label for="r">Hometown</label><input id="r" role="combobox" aria-controls="r-list" value="Sydney">
    <ul id="r-list" role="listbox" hidden><li role="option">Brisbane</li></ul>`);
  await page.evaluate(() => {
    const input = document.getElementById('r') as HTMLInputElement;
    const list = document.getElementById('r-list')!;
    input.addEventListener('mousedown', () => list.removeAttribute('hidden'));
    list.addEventListener('click', () => {
      input.value = 'Brisbane';
      list.setAttribute('hidden', '');
    });
    input.addEventListener('blur', () => {
      input.value = 'Sydney';
    });
  });
  const r = await execIntent(page, 'Hometown', choice('Brisbane'));
  expect(r.outcome).not.toBe('filled');
  await expect(page.locator('#r')).toHaveValue('Sydney');
});

test('a menu of links is not a list of choices, and is never clicked', async () => {
  await add('<label id="m-label">Office</label><button type="button" id="m" role="combobox" aria-labelledby="m-label">Select</button>');
  await page.evaluate(() => {
    const w = window as unknown as { linkClicks: number };
    w.linkClicks = 0;
    document.getElementById('m')!.addEventListener('click', () => {
      const list = document.createElement('ul');
      list.setAttribute('role', 'menu');
      list.innerHTML = '<li role="none"><a role="menuitem" href="/somewhere">Sydney</a></li>';
      list.addEventListener('click', (e) => {
        e.preventDefault();
        w.linkClicks++;
      });
      setTimeout(() => document.body.append(list), 30);
    });
  });
  const r = await execIntent(page, 'Office', choice('Sydney'));
  expect(r.outcome).not.toBe('filled');
  expect(await page.evaluate(() => (window as unknown as { linkClicks: number }).linkClicks)).toBe(0);
});

for (const href of ['#/apply/step-2', "javascript:__doPostBack('next','')", 'javascript:document.forms[0].submit()', '/jobs/next']) {
  test(`a row that goes somewhere is never clicked: ${href}`, async () => {
    await add('<label id="k-label">Office</label><button type="button" id="k" role="combobox" aria-labelledby="k-label">Select</button>');
    await page.evaluate((target) => {
      const w = window as unknown as { rowClicks: number };
      w.rowClicks = 0;
      document.getElementById('k')!.addEventListener('click', () => {
        const list = document.createElement('ul');
        list.setAttribute('role', 'listbox');
        const row = document.createElement('a');
        row.setAttribute('role', 'option');
        row.setAttribute('href', target);
        row.textContent = 'Sydney';
        list.append(row);
        list.addEventListener('click', (e) => {
          e.preventDefault();
          w.rowClicks++;
        });
        setTimeout(() => document.body.append(list), 30);
      });
    }, href);
    const r = await execIntent(page, 'Office', choice('Sydney'));
    expect(r.outcome).not.toBe('filled');
    expect(await page.evaluate(() => (window as unknown as { rowClicks: number }).rowClicks)).toBe(0);
  });
}

test('a row that goes nowhere is still a choice', async () => {
  await add('<label id="v-label">Office</label><button type="button" id="v" role="combobox" aria-labelledby="v-label">Select</button>');
  await page.evaluate(() => {
    document.getElementById('v')!.addEventListener('click', () => {
      const list = document.createElement('ul');
      list.setAttribute('role', 'listbox');
      for (const [name, href] of [['Sydney', '#'], ['Perth', 'javascript:void(0)']] as const) {
        const row = document.createElement('a');
        row.setAttribute('role', 'option');
        row.setAttribute('href', href);
        row.textContent = name;
        row.addEventListener('click', (e) => {
          e.preventDefault();
          document.getElementById('v')!.textContent = name;
          list.remove();
        });
        list.append(row);
      }
      setTimeout(() => document.body.append(list), 30);
    });
  });
  const r = await execIntent(page, 'Office', choice('Sydney'));
  expect(r.outcome).toBe('filled');
});

test('closing an unasked dialog leaves the dialog the form is in', async () => {
  await page.evaluate(() => {
    const outer = document.createElement('div');
    outer.id = 'outer';
    outer.setAttribute('role', 'dialog');
    outer.innerHTML = '<form><label id="x-label">Office</label><button type="button" id="x" role="combobox" aria-labelledby="x-label">Select</button></form>';
    outer.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') outer.remove();
    });
    document.body.append(outer);
    outer.querySelector('#x')!.addEventListener('click', () => {
      const dialog = document.createElement('div');
      dialog.id = 'unasked';
      dialog.setAttribute('role', 'dialog');
      dialog.textContent = 'Something else altogether';
      dialog.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') dialog.remove();
      });
      document.body.append(dialog);
    });
  });
  const r = await execIntent(page, 'Office', choice('Sydney'));
  expect(r.outcome).not.toBe('filled');
  expect(await page.locator('#outer').count()).toBe(1);
  expect(await page.locator('#unasked').count()).toBe(0);
});

test('a list that turns up in the page navigation belongs to the page', async () => {
  await add('<label id="n-label">Office</label><button type="button" id="n" role="combobox" aria-labelledby="n-label">Select</button>');
  await page.evaluate(() => {
    const w = window as unknown as { navClicks: number };
    w.navClicks = 0;
    document.getElementById('n')!.addEventListener('click', () => {
      const nav = document.createElement('nav');
      nav.innerHTML = '<ul role="listbox"><li role="option">Sydney</li></ul>';
      nav.addEventListener('click', () => w.navClicks++);
      setTimeout(() => document.body.append(nav), 30);
    });
  });
  const r = await execIntent(page, 'Office', choice('Sydney'));
  expect(r.outcome).not.toBe('filled');
  expect(await page.evaluate(() => (window as unknown as { navClicks: number }).navClicks)).toBe(0);
});

test('a dialog the button brings up instead of a list is closed again', async () => {
  await add('<label id="d-label">Office</label><button type="button" id="d" role="combobox" aria-labelledby="d-label">Select</button>');
  await page.evaluate(() => {
    document.getElementById('d')!.addEventListener('click', () => {
      const dialog = document.createElement('div');
      dialog.setAttribute('role', 'dialog');
      dialog.textContent = 'Something else altogether';
      document.body.append(dialog);
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') dialog.remove();
      });
    });
  });
  const r = await execIntent(page, 'Office', choice('Sydney'));
  expect(r.outcome).not.toBe('filled');
  expect(await page.locator('[role=dialog]').count()).toBe(0);
});

test('a list that belongs to another control is left alone', async () => {
  await add(`<label id="o-label">Office</label><button type="button" id="o" role="combobox" aria-labelledby="o-label" aria-controls="o-gone">Select</button>`);
  await page.evaluate(() => {
    const w = window as unknown as { foreignClicks: number };
    w.foreignClicks = 0;
    document.getElementById('o')!.addEventListener('click', () => {
      const list = document.createElement('ul');
      list.setAttribute('role', 'listbox');
      list.innerHTML = '<li role="option">Sydney</li>';
      list.addEventListener('click', () => w.foreignClicks++);
      setTimeout(() => document.body.append(list), 30);
    });
  });
  const r = await execIntent(page, 'Office', choice('Sydney'));
  expect(r.outcome).not.toBe('filled');
  expect(await page.evaluate(() => (window as unknown as { foreignClicks: number }).foreignClicks)).toBe(0);
});

test('an empty list that is always in the page does not count as open', async () => {
  await add(`<label for="e">Faculty</label><input id="e" role="combobox" aria-controls="e-list">
    <ul id="e-list" role="listbox" style="margin:0;padding:0"></ul>`);
  await page.evaluate(() => {
    const w = window as unknown as { escapes: number };
    w.escapes = 0;
    const input = document.getElementById('e') as HTMLInputElement;
    const list = document.getElementById('e-list')!;
    document.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') w.escapes++;
    });
    input.addEventListener('mousedown', () => {
      list.innerHTML = '<li role="option">Science</li>';
    });
    list.addEventListener('click', () => {
      input.value = 'Science';
      list.innerHTML = '';
    });
  });
  const r = await execIntent(page, 'Faculty', choice('Science'));
  expect(r.outcome).toBe('filled');
  expect(await page.evaluate(() => (window as unknown as { escapes: number }).escapes)).toBe(0);
});

test('a prompt on a button is not a value', async () => {
  await add(`<label id="p-label">Where from</label><button type="button" id="p" role="combobox" aria-labelledby="p-label">Pick a country</button>`);
  const r = await execIntent(page, 'Where from', choice('Canada'));
  expect(r.outcome).not.toBe('filled');
  expect(r.observed ?? null).toBeNull();
});

test('a button with no type inside a form never submits it', async () => {
  await add(`<form id="sf" action="/submitted">
    <label for="q-rel">Would you relocate for this role?</label>
    <div><button id="rel-yes" aria-pressed="false">Yes</button><button aria-pressed="false">No</button><input type="checkbox" name="q-rel" style="display:none"></div>
    <label id="s-label">Start month</label><button id="s" role="combobox" aria-labelledby="s-label" aria-controls="s-list">Select</button>
    <ul id="s-list" role="listbox" hidden><li role="option">March</li></ul>
  </form>`);
  await page.evaluate(() => {
    const w = window as unknown as { submits: number; stillHere: boolean };
    w.submits = 0;
    w.stillHere = true;
    document.getElementById('sf')!.addEventListener('submit', () => w.submits++);
    const yes = document.getElementById('rel-yes')!;
    yes.addEventListener('click', () => yes.setAttribute('aria-pressed', 'true'));
    const trigger = document.getElementById('s')!;
    const list = document.getElementById('s-list')!;
    trigger.addEventListener('click', () => list.removeAttribute('hidden'));
    list.addEventListener('click', () => {
      trigger.textContent = 'March';
      list.setAttribute('hidden', '');
    });
  });
  const answered = await execIntent(page, 'Would you relocate for this role?', choice('Yes'));
  const picked = await execIntent(page, 'Start month', choice('March'));
  expect(answered.outcome).toBe('filled');
  expect(picked.outcome).toBe('filled');
  const state = await page.evaluate(() => {
    const w = window as unknown as { submits: number; stillHere: boolean };
    return { submits: w.submits, stillHere: w.stillHere };
  });
  expect(state).toEqual({ submits: 0, stillHere: true });
});

test('button combobox: no match closes the list', async () => {
  const r = await execIntent(page, 'Employment type', choice('Casual'));
  expect(r.outcome).toBe('no_option');
  expect((await fixtureState(page)).employment).toBe('');
  expect(await openLists(page)).toBe(0);
});
