// What an independent review found the first round of page traps had gone too far on, or not far enough.
import { afterEach, describe, expect, it } from 'vitest';
import { isInOtherCountry } from '../../../src/dictionary/places';
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

function plan(html: string, country = 'Australia') {
  show(html);
  const { contexts, classifications } = scanDocument(document);
  const resume = createSampleProfile().resumes.find((x) => x.id === 'sample-en')!;
  resume.contact.address.country = country;
  return planFill(contexts, classifications, resume, {});
}

const ids = (html: string): string[] => {
  show(html);
  return scanDocument(document).contexts.map((c) => (c.control.el as HTMLElement).id);
};
const yesNo = '<option value=""></option><option>Yes</option><option>No</option>';
const asked = (q: string, country?: string) => plan(`<form><label for="s">${q}</label><select id="s">${yesNo}</select></form>`, country);

describe('a question that names a country', () => {
  it.each([
    ['Are you currently located in Australia?', 'Australia'],
    ['Are you based in Australia?', 'Australia'],
    ['Do you live in Australia?', 'Australia'],
    ['您目前是否在澳大利亚？', 'Australia'],
    ['Are you located in Australia? *', 'Australia'],
  ])('answers when all it asks is where the applicant is: %s', (q, country) => {
    expect(asked(q, country).steps.map((s) => s.fieldKey)).toEqual(['contact.inNamedCountry']);
  });

  it.each([
    'Do you need a visa to live in Australia?',
    'Do you require sponsorship to live in Australia?',
    'Would you be willing to live in Australia?',
    'Are you a citizen or permitted to reside in Australia?',
    'Is your referee based in Australia?',
    'Is your current employer based in Australia?',
    'Are you not located in Australia?',
    '您的配偶目前在中国？',
    '这个岗位是否位于澳大利亚？',
  ])('fills nothing for: %s', (q) => {
    const steps = asked(q).steps.filter((s) => s.fieldKey === 'contact.inNamedCountry');
    expect(steps).toEqual([]);
  });

  it('does not take a note about the job for the question', () => {
    const html = `<form><label for="s" id="q">Do you hold a current licence?</label><select id="s" aria-describedby="d">${yesNo}</select><p id="d">Based in Australia</p></form>`;
    expect(plan(html).steps.filter((s) => s.fieldKey === 'contact.inNamedCountry')).toEqual([]);
  });

  it('does not answer for a referee', () => {
    const html = `<form><h3>Referees</h3><label for="a">Referee name</label><input id="a"><label for="s">Located in Australia?</label><select id="s">${yesNo}</select></form>`;
    expect(plan(html).steps.filter((s) => s.fieldKey === 'contact.inNamedCountry')).toEqual([]);
  });

  it('does not tick a box that has only one answer', () => {
    const html = '<form><label><input id="c" type="checkbox">Do you live in Australia?</label></form>';
    expect(plan(html).steps).toEqual([]);
  });
});

describe('real fields beside words about signing up', () => {
  const form = (extra: string, button = 'Apply') =>
    `<form>${extra}<label for="n">Full name</label><input id="n"><label for="e">Email</label><input id="e"><button>${button}</button></form>`;

  it.each([
    ['a tick box for job alerts', form('<label><input id="t" type="checkbox">Send me job alerts</label>', 'Next')],
    ['a note about the talent pool', form('<p>We may keep you in our talent pool.</p>', 'Next')],
    ['a note that says no', form('<p>This does not subscribe you to anything.</p>', 'Next')],
    ['a heading with the word in it', form('<h2>Apply: Subscriptions Manager</h2>', 'Next')],
    ['the same in Chinese', form('<p>可选择加入人才库</p>', '下一步')],
    ['a strip beside the form', `<section><p>Subscribe to our newsletter</p>${form('')}</section>`],
  ])('keeps them: %s', (_name, html) => {
    expect(ids(html)).toEqual(expect.arrayContaining(['n', 'e']));
  });

  it('keeps a form inside the page header when it is a form of some size', () => {
    const html = '<header><form><label for="a">Full name</label><input id="a"><label for="b">Email</label><input id="b"><label for="c">Phone</label><input id="c"></form></header>';
    expect(ids(html)).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('keeps a form still fading in', () => {
    const html = '<div style="opacity: 0; transition-duration: 0.3s"><form><label for="a">Full name</label><input id="a"><label for="b">Email</label><input id="b"><label for="c">Phone</label><input id="c"></form></div>';
    expect(ids(html)).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });

  it('still skips one see-through box', () => {
    expect(ids('<form><label for="a">Full name</label><input id="a"><div style="opacity: 0"><label for="h">Website</label><input id="h"></div></form>')).toEqual(['a']);
  });
});

describe('traps that are no text box', () => {
  const far = 'position: absolute; left: -9999px';
  const stepKeys = (html: string) => plan(html).steps.map((s) => (s as unknown as { fieldKey: string }).fieldKey);

  it.each([
    ['a select', `<form style="${far}"><label for="s">Country</label><select id="s"><option>Australia</option></select></form>`],
    ['a date box', `<div style="${far}"><label for="s">Date of birth</label><input id="s" type="date"></div>`],
    ['a text area', `<div style="${far}"><label for="s">About me</label><textarea id="s"></textarea></div>`],
    ['a rich text box', `<div style="${far}"><label for="s">About me</label><div id="s" contenteditable="true"></div></div>`],
    ['radio buttons', `<div id="s" style="${far}" role="radiogroup" aria-label="Gender"><label><input type="radio" name="g">Male</label><label><input type="radio" name="g">Female</label></div>`],
  ])('moved off the page: %s', (_name, html) => {
    expect(ids(html)).toEqual([]);
  });

  it('leaves a native select hidden behind a widget to that widget', () => {
    expect(ids('<form><label for="s">Country</label><select id="s" style="opacity: 0; position: absolute"><option>Australia</option></select></form>')).toEqual(['s']);
  });

  it.each([
    ['a select', '<footer><label for="s">Country</label><select id="s"><option>Australia</option></select></footer>'],
    ['a text area', '<footer><label for="s">Feedback</label><textarea id="s"></textarea></footer>'],
    ['a sign-up select', '<form><label for="s">Country</label><select id="s"><option>Australia</option></select><label for="e">Email</label><input id="e"><button>Subscribe</button></form>'],
    ['a sign-up text area', '<form><label for="s">Interests</label><textarea id="s"></textarea><button>Subscribe</button></form>'],
  ])('in the page around the form: %s', (_name, html) => {
    expect(ids(html)).not.toContain('s');
  });

  it.each(['Email (leave this blank if you are human)', 'Leave this field empty', '请勿填写此项'])('leaves a box that asks to be left alone: %s', (label) => {
    expect(stepKeys(`<form><label for="a">${label}</label><input id="a"></form>`)).toEqual([]);
  });
});

describe('consent in other words', () => {
  const steps = (passage: string): unknown[] => {
    const p = plan(`<form><div>Gender</div><div>${passage}</div><div><div><input id="y" type="radio"><label for="y"><div>Male</div></label></div><div><input id="n" type="radio"><label for="n"><div>Female</div></label></div></div></form>`);
    return [...p.steps, ...p.reports.filter((x) => x.outcome === 'needs_review')];
  };
  it.each(['I give permission for these checks.', 'We grant the company access to my record.', '我確認以上資料屬實，並授權查核。', '我确认以上内容属实。', 'I hereby confirm the above.', 'I have read and understood the privacy notice.'])('%s', (passage) => {
    expect(steps(passage)).toEqual([]);
  });
});

describe('places written in other ways', () => {
  it.each([
    ['Sydney, New South Wales, 2000', 'Australia'],
    ['北京, 北京市, 中华人民共和国', 'China'],
    ['Beijing, Beijing, PRC', 'China'],
  ])('%s is at home in %s', (label, home) => {
    expect(isInOtherCountry(label, home)).toBe(false);
  });

  it('still knows a place in another country', () => {
    expect(isInOtherCountry('Adelaide, SA, South Africa', 'Australia')).toBe(true);
  });
});
