// What the review of the last round of page traps and Chinese labels still found wrong.
import { afterEach, describe, expect, it } from 'vitest';
import { planFill } from '../../../src/engine/plan';
import { scanDocument } from '../../../src/engine/scan';
import { createSampleProfile } from '../../../src/schema/samples';

afterEach(() => {
  document.body.replaceChildren();
});

function show(html: string): void {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  document.body.replaceChildren(...Array.from(doc.body.childNodes).map((n) => document.adoptNode(n)));
}

function plan(html: string, id = 'sample-zh') {
  show(html);
  const { contexts, classifications } = scanDocument(document);
  return planFill(contexts, classifications, createSampleProfile().resumes.find((x) => x.id === id)!, {});
}

const keys = (html: string, id?: string): string[] => plan(html, id).steps.map((s) => s.fieldKey);
const box = (label: string): string => `<div><label for="p">${label}</label><input id="p"></div>`;
const yesNo = '<option value=""></option><option>Yes</option><option>No</option>';

describe('a see-through block', () => {
  const boxes = '<label for="a">Full name</label><input id="a"><label for="b">Email</label><input id="b"><label for="c">Phone</label><input id="c">';

  it('is not filled for holding three boxes', () => {
    expect(keys(`<form><div style="opacity: 0">${boxes}</div></form>`, 'sample-en')).toEqual([]);
  });

  it('is not filled for holding buttons as well', () => {
    const html = '<form><div style="opacity: 0"><label for="b">Email</label><input id="b"><input type="submit"><input type="reset"></div></form>';
    expect(keys(html, 'sample-en')).toEqual([]);
  });

  it('is filled while it is really fading in', () => {
    const html = `<form><div style="opacity: 0; transition-duration: 0.3s">${boxes}</div></form>`;
    expect(keys(html, 'sample-en')).toEqual(expect.arrayContaining(['contact.email']));
  });

  it('is not filled for a fade around one box', () => {
    const html = '<form><div style="opacity: 0; transition-duration: 0.3s"><label for="b">Email</label><input id="b"></div></form>';
    expect(keys(html, 'sample-en')).toEqual([]);
  });
});

describe('Taiwanese wording for a postcode', () => {
  it.each(['郵遞區號', '郵政編碼', '郵編', '邮递区号'])('%s is no dial code', (label) => {
    const steps = plan(`<form><h2>聯絡方式</h2>${box(label)}</form>`).steps;
    expect(steps.map((s) => s.fieldKey)).not.toContain('contact.phoneCountryCode');
  });

  it.each(['區號', '国际区号', '电话区号'])('%s still is one', (label) => {
    expect(keys(`<form><h2>联系方式</h2>${box(label)}</form>`)).toEqual(['contact.phoneCountryCode']);
  });
});

describe('asking how to reach someone else', () => {
  it.each(['推荐人', '证明人', '紧急联系人', '家庭成员', 'Referees', 'Emergency contact'])('%s: not the applicant’s own number', (title) => {
    const stepKeys = keys(`<form><h2>${title}</h2>${box('联系方式')}</form>`);
    expect(stepKeys).not.toContain('contact.phone');
    expect(stepKeys).not.toContain('contact.phoneFull');
  });

  it.each(['推荐人', '证明人'])('%s: not the applicant’s own name or email', (title) => {
    const stepKeys = keys(`<form><h2>${title}</h2>${box('邮箱')}<div><label for="q">电话</label><input id="q"></div></form>`);
    expect(stepKeys).not.toContain('contact.email');
    expect(stepKeys).not.toContain('contact.phone');
  });

  it('still asks the applicant under their own heading', () => {
    expect(keys(`<form><h2>联系方式</h2>${box('联系方式')}</form>`)).toEqual(['contact.phone']);
  });
});

describe('a time that is no date', () => {
  it.each(['每周可实习时间', '每周实习天数', '可实习时长', '每月可实习天数', '可实习多久', '实习时长'])('%s', (label) => {
    expect(keys(`<form><h2>求职意向</h2>${box(label)}</form>`)).not.toContain('jobIntention.availableFrom');
  });

  it.each(['可实习时间', '到岗时间', '最快到岗时间'])('%s still is one', (label) => {
    const html = `<form><h2>求职意向</h2><div><label for="p">${label}</label><input id="p" type="date"></div></form>`;
    const { steps, reports } = plan(html);
    expect([...steps.map((s) => s.fieldKey), ...reports.map((r) => r.fieldKey)]).toEqual(['jobIntention.availableFrom']);
  });
});

describe('a place asked about in a part of the form about something else', () => {
  const asked = (title: string): string[] =>
    keys(`<form><h2>${title}</h2><div><label for="s">Located in Australia?</label><select id="s">${yesNo}</select></div></form>`, 'sample-en');

  it.each(['Work history', 'Work experience', 'Education', 'Projects', 'Awards'])('%s', (title) => {
    expect(asked(title)).not.toContain('contact.inNamedCountry');
  });

  it.each(['Contact information', 'Personal information', 'About you'])('%s is about the applicant', (title) => {
    expect(asked(title)).toContain('contact.inNamedCountry');
  });

  it('with no heading at all it is about the applicant', () => {
    const html = `<form><div><label for="s">Are you located in Australia?</label><select id="s">${yesNo}</select></div></form>`;
    expect(keys(html, 'sample-en')).toContain('contact.inNamedCountry');
  });
});
