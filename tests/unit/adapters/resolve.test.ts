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
