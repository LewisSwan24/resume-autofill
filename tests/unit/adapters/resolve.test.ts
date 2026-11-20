import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import { ADAPTERS } from '../../../src/adapters';
import { matchesUrl, resolveAdapter } from '../../../src/adapters/resolve';
import type { AtsAdapter } from '../../../src/adapters/types';
import { discover } from '../../../src/engine/discover';
import { scanDocument } from '../../../src/engine/scan';

afterEach(() => {
  document.body.innerHTML = '';
});

const site: AtsAdapter = {
  id: 'site',
  match: { urls: ['https://jobs.example.test/*', 'https://*.tenant.test/apply/*'], fingerprints: ['.ats-marker'] },
};

describe('matchesUrl', () => {
  it('takes a wildcard path', () => {
    expect(matchesUrl('https://jobs.example.test/*', 'https://jobs.example.test/acme/1/apply')).toBe(true);
  });

  it('takes a wildcard tenant, but only inside the host', () => {
    expect(matchesUrl('https://*.tenant.test/apply/*', 'https://acme.tenant.test/apply/1')).toBe(true);
    expect(matchesUrl('https://*.tenant.test/apply/*', 'https://evil.test/x.tenant.test/apply/1')).toBe(false);
  });

  it('does not take a look-alike host', () => {
    expect(matchesUrl('https://jobs.example.test/*', 'https://jobs.example.test.evil.test/x')).toBe(false);
    expect(matchesUrl('https://jobs.example.test/*', 'https://jobsxexample.test/x')).toBe(false);
  });
});

describe('resolveAdapter', () => {
  it('goes by the address first', () => {
    const doc = document.implementation.createHTMLDocument('x');
    expect(resolveAdapter(doc, [site], 'https://jobs.example.test/a')).toBe(site);
  });

  it('falls back to a page marker', () => {
    document.body.innerHTML = '<div class="ats-marker"></div>';
    expect(resolveAdapter(document, [site], 'https://careers.acme.test/')).toBe(site);
  });

  it('reads a marker inside a shadow root', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = '<div class="ats-marker"></div>';
    expect(resolveAdapter(shadow, [site], 'https://careers.acme.test/')).toBe(site);
  });

  it('leaves every other page to the general engine', () => {
    document.body.innerHTML = '<form><input></form>';
    expect(resolveAdapter(document, [site], 'https://careers.acme.test/')).toBeNull();
  });

  it('keeps site addresses out of the dispatcher', () => {
    const source = readFileSync('src/adapters/resolve.ts', 'utf8');
    expect(source).not.toMatch(/\b[a-z0-9-]+\.(?:com|co|io|net|org|ai)\b/i);
  });

  it('gives every adapter a real address', () => {
    for (const a of ADAPTERS) expect(a.match.urls.length, a.id).toBeGreaterThan(0);
  });

  it('waits on a board that stores an upload before it reads it, and gives the sign time to show', () => {
    const doc = document.implementation.createHTMLDocument('x');
    const adapter = resolveAdapter(doc, ADAPTERS, 'https://ats.rippling.com/en-AU/some-board/jobs/1/apply');
    expect(adapter?.id).toBe('rippling');
    expect(adapter?.uploadBusy).toBeTruthy();
    expect(adapter?.uploadSignMs ?? 0).toBeGreaterThan(1000);
  });
});

// The shape of one hosted form, with made-up questions.
const hostedForm = (extra = ''): string => `<form>
  <ul>
    <li class="application-question"><label><div class="application-label">Full name</div>
      <div class="application-field"><input name="name" type="text"></div></label></li>
    <li class="application-question custom-question"><div>
      <div class="application-label"><div class="text">What is the highest degree you hold?<span class="required">✱</span></div></div>
      <div class="application-field"><select name="cards[a][field0]"><option value="">Select...</option><option>Bachelor</option><option>Master</option></select></div>
    </div></li>
    ${extra}
  </ul></form>`;

describe('the job board adapter', () => {
  const board = `
    <div><label for="email">Email</label><input id="email" type="text"></div>
    <div><label for="home">Country</label><input id="home" role="combobox" aria-expanded="false" type="text"></div>
    <fieldset class="phone-input">
      <div class="phone-input__country"><label id="c-label" for="country">Country</label>
        <input id="country" role="combobox" aria-expanded="false" aria-labelledby="c-label" type="text"></div>
      <div class="phone-input__phone"><label for="phone">Phone</label><input id="phone" type="tel"></div>
    </fieldset>`;

  it('is found on the board and on a page that embeds its form', () => {
    document.body.innerHTML = '';
    expect(resolveAdapter(document, ADAPTERS, 'https://job-boards.greenhouse.io/acme/jobs/1')?.id).toBe('greenhouse');
    document.body.innerHTML = board;
    expect(resolveAdapter(document, ADAPTERS, 'https://careers.acme.example/job')?.id).toBe('greenhouse');
  });

  it('reads the country beside the phone as the phone code, not as where the applicant lives', () => {
    document.body.innerHTML = board;
    const { contexts, classifications } = scanDocument(document);
    const of = (id: string) => classifications[contexts.findIndex((c) => c.control.el.id === id)]!;
    expect(of('country').fieldKey).toBe('contact.phoneCountryCode');
    expect(of('country').confidence).toBeGreaterThan(0.75);
    expect(of('home').fieldKey).toBe('contact.addressCountry');
  });
});

describe('the wizard adapter', () => {
  const step = (extra = ''): string => `<div data-automation-id="applyFlowPage">
    <div data-automation-id="formField-legalName--firstName"><label for="g">Given Name</label><input type="text" id="g"></div>
    <div data-automation-id="formField-source"><label for="source--source">How Did You Hear About Us?</label>
      <div data-automation-id="multiSelectContainer"><div data-automation-id="multiselectInputContainer"><input id="source--source"></div></div></div>
    <div data-automation-id="formField-preferredCheck"><label for="p">I have a preferred name</label><input id="p" type="checkbox"></div>
    <div data-automation-id="formField-legalName--middleName"><label for="m">Middle Name</label><input id="m" type="text"></div>
    <div data-automation-id="formField-phoneType"><label for="t">Phone Device Type</label><button aria-haspopup="listbox" id="t">Mobile</button></div>
    <div data-automation-id="formField-extension"><label for="x">Phone Extension</label><input id="x" type="text"></div>
    <div><label for="sms">SMS Opt-in</label><input id="sms" type="checkbox" data-automation-id="phone-sms-opt-in"></div>
    ${extra}</div>`;

  it('fits every tenant by address, and by the page on a domain of its own', () => {
    const doc = document.implementation.createHTMLDocument('x');
    const idOf = (href: string) => resolveAdapter(doc, ADAPTERS, href)?.id ?? null;
    expect(idOf('https://acme.wd5.myworkdayjobs.com/en-US/Careers/job/x/apply')).toBe('workday');
    expect(idOf('https://acme.wd3.myworkdaysite.com/recruiting/acme/x')).toBe('workday');
    expect(idOf('https://myworkdayjobs.com.evil.test/x')).toBeNull();
    document.body.innerHTML = step();
    expect(resolveAdapter(document, ADAPTERS, 'https://careers.acme.test/')?.id).toBe('workday');
  });

  it('turns a search-and-pick box into a pick list', () => {
    document.body.innerHTML = step();
    const box = discover(document).find((c) => c.el.id === 'source--source')!;
    expect(box).toMatchObject({ kind: 'select', lib: 'workday' });
    expect(box.prompt).toBeTruthy();
  });

  it('leaves out controls with nothing in a resume to fill them', () => {
    document.body.innerHTML = step();
    const ids = discover(document).map((c) => c.el.id);
    for (const gone of ['p', 'm', 't', 'x']) expect(ids).not.toContain(gone);
    expect(ids).toContain('g');
  });

  it.each([
    ['Country / Territory', 'contact.addressCountry'],
    ['Country / Territory Phone Code', 'contact.phoneCountryCode'],
    ['Suburb/Locality', 'contact.addressCity'],
    ['State or Territory', 'contact.addressProvince'],
  ])('reads "%s" as %s', (label, key) => {
    document.body.innerHTML = step(`<div><label for="q">${label}</label><input id="q" type="text"></div>`);
    const { contexts, classifications } = scanDocument(document);
    const i = contexts.findIndex((c) => c.control.el.id === 'q');
    expect(classifications[i]!.fieldKey).toBe(key);
  });

  it('tells the country from the phone code beside it', () => {
    document.body.innerHTML = step(`
      <div><label for="c">Country / Territory</label>
        <button id="c" name="country" type="button" aria-haspopup="listbox" aria-label="Country / Territory Australia Required">Australia</button></div>
      <div data-automation-id="multiSelectContainer"><label for="p">Country / Territory Phone Code</label><input id="p" name="phoneNumber--countryPhoneCode" type="text"></div>`);
    const { contexts, classifications } = scanDocument(document);
    const of = (id: string) => classifications[contexts.findIndex((c) => c.control.el.id === id)]!;
    expect(of('c').fieldKey).toBe('contact.addressCountry');
    expect(of('c').confidence).toBeGreaterThan(0.75);
    expect(of('p').fieldKey).toBe('contact.phoneCountryCode');
    expect(of('p').confidence).toBeGreaterThan(0.75);
  });

  it('never fills an opt-in', () => {
    document.body.innerHTML = step();
    const { contexts, classifications } = scanDocument(document);
    const i = contexts.findIndex((c) => c.control.el.id === 'sms');
    expect(classifications[i]!.fieldKey).toBeNull();
  });
});

describe('the hosted form adapter', () => {
  it('reads a custom question as the label of its control', () => {
    document.body.innerHTML = hostedForm();
    const { contexts } = scanDocument(document);
    const select = contexts.find((c) => c.control.el.tagName === 'SELECT')!;
    expect(select.evidence[0]).toMatchObject({ source: 'label-for', text: 'What is the highest degree you hold?', weight: 1 });
  });

  it('still sends consent wording in a custom question to the never-fill check', () => {
    document.body.innerHTML = hostedForm(`<li class="application-question custom-question"><div>
      <div class="application-label"><div class="text">I consent to the privacy policy</div></div>
      <div class="application-field"><select name="cards[a][field1]"><option value="">Select...</option><option>Yes</option></select></div></div></li>`);
    const { contexts, classifications } = scanDocument(document);
    const i = contexts.findIndex((c) => c.control.el.getAttribute('name') === 'cards[a][field1]');
    expect(classifications[i]!.fieldKey).toBeNull();
  });

  it('treats the location box as a search box, and its hidden value as nothing', () => {
    document.body.innerHTML = hostedForm(`<li class="application-question"><label><div class="application-label">Current location</div>
      <div class="application-field"><input class="location-input" id="location-input" name="location" type="text">
      <input id="selected-location" type="hidden" name="selectedLocation">
      <div class="dropdown-container"><div class="dropdown-results"></div></div></div></label></li>`);
    const box = discover(document).find((c) => c.el.id === 'location-input')!;
    expect(box).toMatchObject({ kind: 'select', lib: 'search' });
    expect(box.search?.option).toBeTruthy();
    expect(discover(document).filter((c) => (c.el as HTMLInputElement).name === 'selectedLocation')).toEqual([]);
  });

  it('reads a custom question for a group of radio buttons', () => {
    document.body.innerHTML = hostedForm(`<li class="application-question custom-question"><div>
      <div class="application-label"><div class="text">Which degree do you hold?</div></div>
      <div class="application-field"><ul><li><label><input type="radio" name="cards[a][field2]" value="Bachelor">Bachelor</label></li>
      <li><label><input type="radio" name="cards[a][field2]" value="Master">Master</label></li></ul></div></div></li>`);
    const group = scanDocument(document).contexts.find((c) => c.control.kind === 'radio')!;
    expect(group.evidence[0]).toMatchObject({ source: 'label-for', text: 'Which degree do you hold?' });
  });

  it('changes nothing on a page without the marker', () => {
    document.body.innerHTML = `<form><div><div class="text">What is the highest degree you hold?</div>
      <select name="degree"><option>Master</option></select></div></form>`;
    const { contexts } = scanDocument(document);
    expect(contexts[0]!.evidence.some((e) => e.source === 'label-for')).toBe(false);
    expect(contexts[0]!.control.lib).toBe('native');
  });
});

describe('workable', () => {
  it('reads the summary at the top of the form as the profile, and the one in an editor as the job', () => {
    document.body.innerHTML = `<div data-ui="careers-page-content">
      <label><span>Summary (Optional)</span><textarea data-ui="summary" name="summary"></textarea></label>
      <label><span>Headline (Optional)</span><input name="headline" /></label>
      <div data-ui="experience"><p>Experience</p><ul><li><div data-ui="editor">
        <label><span>Summary (Optional)</span><textarea name="summary"></textarea></label>
      </div></li></ul></div>
    </div>`;
    const { contexts, classifications } = scanDocument(document);
    const keyOf = (selector: string) => {
      const el = document.querySelector(selector);
      return classifications[contexts.findIndex((c) => c.control.el === el)]?.fieldKey;
    };
    expect(keyOf('textarea[data-ui="summary"]')).toBe('misc.selfIntroduction');
    expect(keyOf('[data-ui="editor"] textarea')).toBe('work.description');
    expect(keyOf('input[name="headline"]')).toBeUndefined();
  });

  it('is found by its host, and on a company domain by its marker', () => {
    expect(resolveAdapter(document, ADAPTERS, 'https://apply.workable.com/acme/j/ABC/apply/')?.id).toBe('workable');
    document.body.innerHTML = '<div data-ui="careers-page-content"></div>';
    expect(resolveAdapter(document, ADAPTERS, 'https://careers.acme.test/j/ABC/apply/')?.id).toBe('workable');
  });
});
