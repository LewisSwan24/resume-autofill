// Things real application pages do that read as ordinary fields until you look closely.
import { afterEach, describe, expect, it } from 'vitest';
import { labelSimilarity } from '../../../src/dictionary/similarity';
import { FIELD_DEPS } from '../../../src/engine/fieldDeps';
import { planFill } from '../../../src/engine/plan';
import { scanDocument } from '../../../src/engine/scan';
import { createSampleProfile } from '../../../src/schema/samples';

afterEach(() => {
  document.body.innerHTML = '';
});

type FillStepLike = { fieldKey?: string | null };
const depsOf = (key: string): readonly string[] | undefined => (FIELD_DEPS as Record<string, readonly string[]>)[key];

function classify(html: string): { label: string; key: string | null; el: HTMLElement }[] {
  document.body.innerHTML = html;
  const { contexts, classifications } = scanDocument(document);
  return contexts.map((c, i) => ({ label: c.evidence[0]?.text ?? '', key: classifications[i]?.fieldKey ?? null, el: c.control.el }));
}

function planOf(html: string) {
  document.body.innerHTML = html;
  const { contexts, classifications } = scanDocument(document);
  const resume = createSampleProfile().resumes.find((x) => x.id === 'sample-en')!;
  const out = planFill(contexts, classifications, resume, {});
  return out.steps;
}

describe('radio buttons with no name and no group around them', () => {
  const answers = (ids: string[], labels: string[]) =>
    ids.map((id, i) => `<div><input id="${id}" type="radio"><label for="${id}"><div>${labels[i]}</div></label></div>`).join('');

  it('are one question, read from the text above them, past a paragraph of help', () => {
    document.body.innerHTML = `<form><span>Do you need visa sponsorship?</span>
      <div>We may provide immigration and sponsorship support to new employees based on their unique circumstances, and this will not affect how we consider the application.</div>
      <div>${answers(['y', 'n', 'x'], ['Yes', 'No', 'N/A'])}</div></form>`;
    const { contexts } = scanDocument(document);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]?.control.kind).toBe('radio');
    expect(contexts[0]?.control.options?.map((o) => o.label)).toEqual(['Yes', 'No', 'N/A']);
    expect(contexts[0]?.evidence.map((e) => e.text)).toContain('Do you need visa sponsorship?');
  });

  it('read the question at the start of a block that goes on with help', () => {
    document.body.innerHTML = `<form><div><span>Do you need visa sponsorship?<span>*</span></span>
      <div>We may provide immigration and sponsorship support to new employees based on their unique circumstances, and this will not affect how we consider the application.</div></div>
      <div><div>${answers(['y', 'n'], ['Yes', 'No'])}</div></div></form>`;
    const { contexts } = scanDocument(document);
    expect(contexts[0]?.evidence.map((e) => e.text)).toContain('Do you need visa sponsorship?');
  });

  it('split where the same answers come again', () => {
    document.body.innerHTML = `<form><div>${answers(['a', 'b'], ['Yes', 'No'])}${answers(['c', 'd'], ['Yes', 'No'])}</div></form>`;
    expect(scanDocument(document).contexts.map((c) => c.control.options?.length)).toEqual([2, 2]);
  });

  it('split where a question stands between them', () => {
    document.body.innerHTML = `<form><div><p>First question?</p>${answers(['a', 'b'], ['Yes', 'No'])}<p>Second question?</p>${answers(['c', 'd'], ['Agree', 'Disagree'])}</div></form>`;
    expect(scanDocument(document).contexts.map((c) => c.control.options?.length)).toEqual([2, 2]);
  });

  it('split per block when each question has a box of its own', () => {
    document.body.innerHTML = `<form><div>${answers(['a', 'b'], ['Yes', 'No'])}</div><div>${answers(['c', 'd'], ['Agree', 'Disagree'])}</div></form>`;
    expect(scanDocument(document).contexts.map((c) => c.control.options?.length)).toEqual([2, 2]);
  });

  it('with a text box between them are not one question', () => {
    document.body.innerHTML = `<form><div>${answers(['a'], ['Yes'])}<input id="t" type="text">${answers(['b'], ['No'])}</div></form>`;
    expect(scanDocument(document).contexts).toHaveLength(3);
  });
});

describe('a state written short', () => {
  const pick = (province: string, country: string, labels: string[]): string | null => {
    document.body.innerHTML = `<form><label for="s">State</label><select id="s">${labels.map((l) => `<option>${l}</option>`).join('')}</select></form>`;
    const { contexts, classifications } = scanDocument(document);
    const sample = createSampleProfile().resumes.find((x) => x.id === 'sample-en')!;
    const resume = { ...sample, contact: { ...sample.contact, address: { ...sample.contact.address, province, country } } };
    const step = planFill(contexts, classifications, resume, {}).steps[0];
    if (step?.intent.kind !== 'choice') return null;
    const m = step.intent.match(labels.map((label) => ({ label })));
    return m.status === 'matched' ? labels[m.index]! : null;
  };

  it.each([
    ['SA', 'Australia', ['South Africa', 'South Australia', 'Kansas'], 'South Australia'],
    ['SA', 'Australia', ['USA', 'Samoa', 'Saudi Arabia', 'Kansas'], null],
    ['SA', 'Australia', ['Queensland', 'SA', 'Victoria'], 'SA'],
    ['SA', 'Australia', ['Queensland', 'South Australia (SA)', 'Victoria'], 'South Australia (SA)'],
    ['SA', 'Australia', ['QLD - Queensland', 'SA - South Australia'], 'SA - South Australia'],
    ['WA', 'Australia', ['Delaware', 'Western Australia'], 'Western Australia'],
    ['WA', 'Australia', ['Delaware', 'Iowa', 'Hawaii'], null],
    ['WA', 'United States', ['Delaware', 'Washington'], null],
    ['NT', 'Australia', ['Vermont', 'Montana'], null],
    ['QLD', 'Australia', ['Queensland', 'Victoria'], 'Queensland'],
    ['Queensland', 'Australia', ['QLD', 'VIC'], 'QLD'],
  ])('%s in %s among %j is %s', (province, country, labels, expected) => {
    expect(pick(province, country, labels)).toBe(expected);
  });
});

describe('a question about being in a named country', () => {
  const answer = (question: string, country: string, labels = ['Select...', 'Yes', 'No']): string | null => {
    document.body.innerHTML = `<form><label for="s">${question}</label><select id="s">${labels.map((l) => `<option>${l}</option>`).join('')}</select></form>`;
    const { contexts, classifications } = scanDocument(document);
    const sample = createSampleProfile().resumes.find((x) => x.id === 'sample-en')!;
    const resume = { ...sample, contact: { ...sample.contact, address: { ...sample.contact.address, country } } };
    const step = planFill(contexts, classifications, resume, {}).steps[0];
    if (step?.intent.kind !== 'choice') return null;
    const m = step.intent.match(labels.map((label) => ({ label })));
    return m.status === 'matched' ? labels[m.index]! : null;
  };

  it.each([
    ['Are you currently located in Australia?', 'Australia', 'Yes'],
    ['Are you based in Australia?', 'AUS', 'Yes'],
    ['Do you live in New Zealand?', 'New Zealand', 'Yes'],
    ['Are you currently residing in the United States?', 'USA', 'Yes'],
    ['Are you currently located in Australia?', 'New Zealand', 'No'],
    ['Are you located in the UK?', 'Australia', 'No'],
    ['目前是否在中国？', '中国', 'Yes'],
  ])('%s, living in %s, is %s', (question, country, expected) => {
    expect(answer(question, country)).toBe(expected);
  });

  it.each([
    ['Are you currently located in Australia?', ''],
    ['Are you currently located in Atlantis?', 'Australia'],
    ['Are you based in Australia or New Zealand?', 'Australia'],
    ['Are you located in Australia and able to commute to our office?', 'Australia'],
    ['Are you authorised to work in Australia?', ''],
  ])('%s, living in %j, gets no answer from this', (question, country) => {
    expect(answer(question, country)).toBeNull();
  });

  it('asks only a list that has the answers: a text box is left alone', () => {
    document.body.innerHTML = '<form><label for="s">Are you currently located in Australia?</label><input id="s"></form>';
    const { contexts, classifications } = scanDocument(document);
    const resume = createSampleProfile().resumes.find((x) => x.id === 'sample-en')!;
    expect(planFill(contexts, classifications, resume, {}).steps).toEqual([]);
  });

  it('sends a frame only the country it needs', () => {
    expect(depsOf('contact.inNamedCountry')).toEqual(['contact.addressCountry']);
  });
});

describe('a place search for a city in a state written short', () => {
  const pick = (city: string, province: string, country: string, labels: string[]): string | null => {
    document.body.innerHTML = '<form><label for="s">Current location</label><input id="s" role="combobox"></form>';
    const { contexts, classifications } = scanDocument(document);
    const sample = createSampleProfile().resumes.find((x) => x.id === 'sample-en')!;
    const resume = { ...sample, contact: { ...sample.contact, address: { ...sample.contact.address, city, province, country } } };
    const step = planFill(contexts, classifications, resume, {}).steps[0];
    if (step?.intent.kind !== 'choice') return 'no choice';
    const m = step.intent.match(labels.map((label) => ({ label })));
    return m.status === 'matched' ? labels[m.index]! : null;
  };

  it.each([
    ['Adelaide', 'SA', 'Australia', ['Adelaide, SA, South Africa'], null],
    ['Adelaide', 'SA', 'Australia', ['Adelaide, Eastern Cape, South Africa'], null],
    ['Adelaide', 'SA', 'Australia', ['Adelaide, Eastern Cape, South Africa', 'Adelaide SA, Australia'], 'Adelaide SA, Australia'],
    ['Adelaide', 'SA', 'Australia', ['Adelaide, South Africa', 'Adelaide, South Australia, AUS'], 'Adelaide, South Australia, AUS'],
    ['Adelaide', 'SA', '', ['Adelaide, South Africa'], null],
    ['Perth', 'WA', 'Australia', ['Perth, Scotland, UK', 'Perth WA, Australia'], 'Perth WA, Australia'],
    ['Perth', 'WA', 'Australia', ['Perth, WA, USA'], null],
    ['Durban', 'KZN', 'South Africa', ['Durban, KZN, South Africa'], 'Durban, KZN, South Africa'],
    ['Brisbane', 'QLD', 'Australia', ['Brisbane City, Brisbane, QLD 4000'], null],
    ['Brisbane', 'QLD', 'Australia', ['Brisbane, Inner City, QLD 4000'], 'Brisbane, Inner City, QLD 4000'],
    ['Brisbane', 'QLD', 'Australia', ['Brisbane, San Mateo County, California'], null],
  ])('%s %s %s among %j is %s', (city, province, country, labels, expected) => {
    expect(pick(city, province, country, labels)).toBe(expected);
  });
});

describe('a form beside the application', () => {
  const application = '<form id="apply"><label for="n">First name</label><input id="n"><label for="e">Email</label><input id="e" type="email"><button type="submit">Submit application</button></form>';
  const ids = (html: string): string[] => {
    document.body.innerHTML = html;
    return scanDocument(document).contexts.map((c) => c.control.el.id);
  };

  it.each([
    ['in the footer', '<footer><form><input id="x" type="email" placeholder="Email"><button>Go</button></form></footer>'],
    ['in the header', '<header><form><input id="x" type="email" placeholder="Email"></form></header>'],
    ['in the navigation', '<nav><input id="x" placeholder="Email"></nav>'],
    ['for a newsletter', '<section><h3>Join our newsletter</h3><form><input id="x" type="email" aria-label="Email"><button>Join</button></form></section>'],
    ['to subscribe', '<div><form><input id="x" type="email" aria-label="Email"><button>Subscribe</button></form></div>'],
    ['with no form around it', '<div><p>Subscribe to our news</p><input id="x" type="email" aria-label="Email"><button>Send</button></div>'],
    ['for job alerts', '<form><label for="x">Email</label><input id="x" type="email"><button>Get job alerts</button></form>'],
    ['for a talent community', '<aside><h4>Join our talent community</h4><form><input id="x" type="email" aria-label="Email"><input id="y" aria-label="First name"></form></aside>'],
    ['to subscribe, in Chinese', '<form><input id="x" type="email" aria-label="邮箱"><button>订阅</button></form>'],
  ])('is left alone %s', (_name, html) => {
    expect(ids(application + html)).toEqual(['n', 'e']);
  });

  it('is still the form when the application is what it is for', () => {
    expect(ids(application)).toEqual(['n', 'e']);
    expect(ids('<form><label for="e">Email</label><input id="e" type="email"><button>Continue</button></form>')).toEqual(['e']);
  });

  it('keeps a long application that offers job alerts along the way', () => {
    const long = '<form><label for="a">First name</label><input id="a"><label for="b">Last name</label><input id="b"><label for="c">Email</label><input id="c" type="email"><label><input id="d" type="checkbox">Get job alerts</label></form>';
    expect(ids(long)).toEqual(expect.arrayContaining(['a', 'b', 'c']));
  });
});

describe('a question in the same box as its answers', () => {
  const answers = (name: string, a: string, b: string): string =>
    `<label><input type="radio" name="${name}" value="1">${a}</label><label><input type="radio" name="${name}" value="2">${b}</label>`;
  const keysOf = (html: string): (string | null)[] => {
    document.body.innerHTML = html;
    return scanDocument(document).classifications.map((c) => c.fieldKey);
  };

  it.each([
    ['in a block', `<form><div><div>Gender</div>${answers('g', 'Male', 'Female')}</div></form>`],
    ['in a paragraph', `<form><div><p>Gender</p>${answers('g', 'Male', 'Female')}</div></form>`],
    ['in a label of its own', `<form><div><label>Gender</label>${answers('g', 'Male', 'Female')}</div></form>`],
    ['as bare text', `<form><div>Gender<br>${answers('g', 'Male', 'Female')}</div></form>`],
    ['with the answers in a row below', `<form><div><div>Gender</div><div>${answers('g', 'Male', 'Female')}</div></div></form>`],
  ])('is read %s', (_name, html) => {
    expect(keysOf(html)).toEqual(['basics.gender']);
  });

  it('is read for each of two questions in one box', () => {
    document.body.innerHTML = `<form><div><div>Gender</div>${answers('g', 'Male', 'Female')}<div>Do you require visa sponsorship?</div>${answers('v', 'Yes', 'No')}</div></form>`;
    const { contexts } = scanDocument(document);
    expect(contexts.map((c) => c.evidence.map((e) => e.text))).toEqual([['Gender'], ['Do you require visa sponsorship?']]);
  });

  it('is not an answer written before its button', () => {
    document.body.innerHTML = '<form><div>Gender</div><div><label for="m">Male</label><input id="m" type="radio" name="g"><label for="f">Female</label><input id="f" type="radio" name="g"></div></form>';
    const { contexts } = scanDocument(document);
    expect(contexts[0]?.evidence.map((e) => e.text)).toEqual(['Gender']);
  });

  it('keeps consent as consent', () => {
    expect(planOf(`<form><div><div>I agree to the terms</div>${answers('t', 'Yes', 'No')}</div></form>`)).toEqual([]);
  });

  it('leaves answers with no question alone', () => {
    expect(planOf(`<form><div>${answers('t', 'Yes', 'No')}</div></form>`)).toEqual([]);
  });

  it('gives no question to the answers above it', () => {
    document.body.innerHTML = `<form><div>${answers('g', 'Male', 'Female')}<div>Thanks for telling us</div></div></form>`;
    expect(scanDocument(document).contexts[0]?.evidence).toEqual([]);
  });
});

describe('consent further up than the nearest words', () => {
  const long = 'This is the part that goes on for a while and explains what happens to your record after you answer it here today.';
  const loose = (a: string, b: string): string =>
    `<div><div>${[a, b].map((t, i) => `<div><input id="q${i}" type="radio"><label for="q${i}"><div>${t}</div></label></div>`).join('')}</div></div>`;
  const planned = (html: string): FillStepLike[] => {
    document.body.innerHTML = html;
    const { contexts, classifications } = scanDocument(document);
    const resume = createSampleProfile().resumes.find((x) => x.id === 'sample-en')!;
    const plan = planFill(contexts, classifications, resume, {});
    return [...plan.steps, ...plan.reports.filter((x) => x.outcome === 'needs_review')];
  };

  it.each([
    ['behind a second paragraph', `<fieldset><legend>Do you need visa sponsorship?</legend><p>I consent to the checks. ${long}</p><p>${long}</p>${loose('Yes', 'No')}</fieldset>`],
    ['as bare text', `<fieldset><legend>Do you need visa sponsorship?</legend>I consent to the checks. ${long}<p>${long}</p>${loose('Yes', 'No')}</fieldset>`],
    ['on a group named by a label', `<div role="radiogroup" aria-label="Do you need visa sponsorship?"><p>I consent to the checks. ${long}</p><p>${long}</p>${loose('Yes', 'No')}</div>`],
    ['short, above the question', `<form><div>I agree to the terms</div><div>Do you need visa sponsorship?</div>${loose('Yes', 'No')}</form>`],
    ['above a lone box', `<form><p>By choosing an answer below I agree to the checks. ${long}</p><label><input id="c" type="checkbox">Do you need visa sponsorship?</label></form>`],
  ])('still stops the answer: %s', (_name, html) => {
    expect(planned(html)).toEqual([]);
  });

  it.each([
    ['names the privacy policy', 'You can read more about this in our privacy policy, which explains how we look after what you tell us.'],
    ['names an agreement', 'Our staff are employed under an enterprise agreement, which sets out the conditions for visa holders here.'],
    ['talks about terms', 'The terms of a visa differ from one country to the next, and we will talk about yours at the interview.'],
  ])('leaves the question alone when the help only %s', (_name, help) => {
    document.body.innerHTML = `<form><div><span>Do you need visa sponsorship?</span><div>${help} ${long}</div></div>${loose('Yes', 'No')}</form>`;
    expect(scanDocument(document).classifications[0]?.fieldKey).toBe('workRights.requiresSponsorship');
  });

  it('does not put a whole passage on the report as the name of a row', () => {
    document.body.innerHTML = `<form><div>I consent to the checks. ${long} ${long}</div>${loose('Yes', 'No')}</form>`;
    const { contexts, classifications } = scanDocument(document);
    const resume = createSampleProfile().resumes.find((x) => x.id === 'sample-en')!;
    const [row] = planFill(contexts, classifications, resume, {}).reports;
    expect(row!.label.length).toBeLessThanOrEqual(81);
  });
});

describe('wording passed over on the way to a question', () => {
  const long = 'This is the part that goes on for a while and explains what happens to your record after you answer it here today.';
  const loose = (a: string, b: string): string =>
    `<div><div>${[a, b].map((t, i) => `<div><input id="q${i}" type="radio"><label for="q${i}"><div>${t}</div></label></div>`).join('')}</div></div>`;

  it.each([
    ['consent under a short title', `<div><span>Full work rights</span><div>I consent to Acme sharing my record with partners. ${long}</div></div>`],
    ['a question to agree to, in the next block', `<div>Full work rights</div><p>Do you agree that we may share your record with others? ${long}</p>`],
    ['consent under a title that has an answer', `<div><span>Visa sponsorship</span><div>I hereby consent and agree to the checks. ${long}</div></div>`],
    ['the word far along the paragraph', `<div><span>Full work rights</span><div>${long} ${long} ${long} I consent to all of it.</div></div>`],
  ])('is still read for consent: %s', (_name, above) => {
    expect(planOf(`<form>${above}${loose('Yes', 'No')}</form>`)).toEqual([]);
  });

  it('leaves a question alone when the help under it is only help', () => {
    document.body.innerHTML = `<form><div><span>Gender</span><div>We ask so that we can report on it, and it stays apart from your application. ${long}</div></div>${loose('Male', 'Female')}</form>`;
    const { contexts, classifications } = scanDocument(document);
    expect(contexts).toHaveLength(1);
    expect(classifications[0]?.fieldKey).toBe('basics.gender');
  });
});

describe('a plain button that opens a list', () => {
  const ARROW = '<svg viewBox="0 0 24 24"><path d="M1 1"></path></svg>';

  it.each(['Please select', 'Select', 'Select...', 'Choose one', '请选择'])('is a field when it says %s and shows an arrow', (prompt) => {
    document.body.innerHTML = `<form><div><div>Gender</div><button type="button"><div>${prompt}<i>${ARROW}</i></div></button></div></form>`;
    const { contexts } = scanDocument(document);
    expect(contexts[0]?.control).toMatchObject({ kind: 'select', lib: 'aria' });
    expect(contexts[0]?.evidence.map((e) => e.text)).toContain('Gender');
  });

  it.each(['aria-haspopup="menu"', 'aria-haspopup="true"', 'aria-expanded="false"'])('is a field when it says so with %s', (attr) => {
    document.body.innerHTML = `<form><div><div>Gender</div><button type="button" ${attr}>Select</button></div></form>`;
    expect(scanDocument(document).contexts[0]?.control).toMatchObject({ kind: 'select', lib: 'aria' });
  });

  it('is no field when nothing shows a list is behind it: it could do anything', () => {
    document.body.innerHTML = '<form><div><div>Gender</div><button type="button">Select</button></div></form>';
    expect(scanDocument(document).contexts).toHaveLength(0);
  });

  it.each([
    ['an arrow to the right', '<svg class="icon-arrow-right" viewBox="0 0 24 24"></svg>'],
    ['an arrow named next', '<i class="next"><svg viewBox="0 0 24 24"></svg></i>'],
    ['a picture of an arrow', '<img src="next.png" alt="">'],
  ])('is no field when what follows the words is %s', (_name, picture) => {
    document.body.innerHTML = `<form><div><div>Gender</div><button type="button">Select ${picture}</button></div></form>`;
    expect(scanDocument(document).contexts).toHaveLength(0);
  });

  it('is no field when its picture comes first, which is how an action looks', () => {
    document.body.innerHTML = `<form><div><div>Gender</div><button type="button">${ARROW}Select</button></div></form>`;
    expect(scanDocument(document).contexts).toHaveLength(0);
  });

  it.each(['Expand', 'Apply', 'Upload', 'Select file', 'Add another'])('is no field when it says %s', (text) => {
    document.body.innerHTML = `<form><div><div>Gender</div><button type="button"><div>${text}</div></button></div></form>`;
    expect(scanDocument(document).contexts).toHaveLength(0);
  });

  it('is no field when it can submit the form', () => {
    document.body.innerHTML = `<form><div><div>Gender</div><button type="submit" aria-haspopup="true">Please select${ARROW}</button></div></form>`;
    expect(scanDocument(document).contexts).toHaveLength(0);
  });
});

describe('a text box that offers a list', () => {
  it('is a combobox when it says it has a list of choices to pick from', () => {
    document.body.innerHTML = '<form><label for="l">Location</label><input id="l" aria-autocomplete="list" aria-haspopup="listbox"></form>';
    expect(scanDocument(document).contexts[0]?.control).toMatchObject({ kind: 'select', lib: 'aria' });
  });

  it.each(['aria-autocomplete="list"', 'aria-autocomplete="both"', 'aria-autocomplete="inline"', 'aria-haspopup="listbox"'])(
    'stays a plain box with only %s: suggestions do not make free text wrong',
    (attr) => {
      document.body.innerHTML = `<form><label for="l">Location</label><input id="l" ${attr}></form>`;
      expect(scanDocument(document).contexts[0]?.control.kind).toBe('text');
    },
  );
});

describe('a label several keys share', () => {
  it('a weaker key cannot take the control from the keys tied above it', () => {
    const rows = classify('<form><input id="p" aria-label="Phone number"></form>');
    expect(rows[0]?.key).toBe('contact.phone');
  });

  it('a bare Location on an applicant form is where the applicant lives', () => {
    const rows = classify('<form><label for="n">First name</label><input id="n"><label for="l">Location</label><input id="l"></form>');
    expect(rows.find((r) => r.el.id === 'l')?.key).toBe('basics.currentLocation');
  });

  it.each(['Office location', 'Hiring location', 'Role location', 'Event location', 'Location of birth', 'Interview location'])(
    '%s is not where the applicant lives',
    (label) => {
      const rows = classify(`<form><label for="n">First name</label><input id="n"><label for="l">${label}</label><input id="l"></form>`);
      expect(rows.find((r) => r.el.id === 'l')?.key).not.toBe('basics.currentLocation');
    },
  );

  it('a Location in a job card stays with the job', () => {
    const rows = classify(`<form><h2>Work experience</h2><label for="c">Company</label><input id="c">
      <label for="l">Location</label><input id="l"></form>`);
    expect(rows.find((r) => r.el.id === 'l')?.key).toBe('work.city');
  });
});

describe('a phone box that keeps the country with the number', () => {
  it.each([
    ['react-phone-number-input', '<div class="PhoneInput"><input id="p" type="tel"></div>'],
    ['a box showing the code in its example', '<div class="iti"><input id="p" type="tel" placeholder="+61 412 345 678"></div>'],
    ['a box asking for it in words', '<div class="iti"><input id="p" type="tel" aria-label="Phone number with country code"></div>'],
  ])('gets the number with its code in %s, or the widget guesses the country', (_name, box) => {
    const row = classify(`<form><label for="p">Phone</label>${box}</form>`).find((r) => r.el.id === 'p');
    expect(row?.key).toBe('contact.phoneFull');
  });

  it('an intl-tel-input box that keeps the country apart gets the plain number', () => {
    const rows = classify('<form><label for="p">Phone</label><div class="iti"><input id="p" type="tel"></div></form>');
    expect(rows.find((r) => r.el.id === 'p')?.key).toBe('contact.phone');
  });

  it('reads a search box showing a dial code as the country code of the number', () => {
    const rows = classify(`<form><div><input id="c" role="combobox" aria-haspopup="listbox" aria-label="Search" placeholder="Search" value="+1 US"></div>
      <label for="p">Phone number</label><input id="p"></form>`);
    expect(rows.find((r) => r.el.id === 'c')?.key).toBe('contact.phoneCountryCode');
  });

  it('a number box beside a code picker takes the plain number, whatever its example shows', () => {
    const rows = classify(`<form><label for="c">Country code</label><select id="c"><option>+61</option><option>+1</option></select>
      <label for="p">Phone number</label><input id="p" placeholder="+61 400 000 000"></form>`);
    expect(rows.find((r) => r.el.id === 'c')?.key).toBe('contact.phoneCountryCode');
    expect(rows.find((r) => r.el.id === 'p')?.key).toBe('contact.phone');
  });

  it.each([
    ['Current wage', 'basics.age'],
    ['Current page', 'basics.age'],
    ['Current stage', 'basics.age'],
    ['Estate', 'contact.addressProvince'],
    ['Sender', 'basics.gender'],
    ['Preference', 'referees.name'],
    ['Emergency contact email', 'emergencyContact.name'],
    ['Emergency contact address', 'emergencyContact.name'],
  ])('does not read %s as %s', (label, wrong) => {
    const rows = classify(`<form><label for="f">${label}</label><input id="f"></form>`);
    expect(rows[0]?.key).not.toBe(wrong);
  });

  it.each(['address_line_2', 'addressLine2', 'address2', 'address-3', 'street_2'])('leaves %s empty by its name', (name) => {
    const rows = classify(`<form><label for="a">Address</label><input id="a" name="address1"><input id="b" name="${name}"></form>`);
    expect(rows.find((r) => r.el.id === 'b')?.key ?? null).toBeNull();
  });

  it.each(['Address line two', 'Second address line', 'Address line 3', 'Address line three'])('leaves %s empty', (label) => {
    const rows = classify(`<form><label for="b">${label}</label><input id="b"></form>`);
    expect(rows[0]?.key ?? null).toBeNull();
  });

  it('an app root hidden while a dialog is open does not lose its fields', () => {
    const rows = classify(`<div id="root" aria-hidden="true"><form><label for="n">First name</label><input id="n">
      <label for="e">Email</label><input id="e"></form></div><div role="dialog" aria-modal="true">Accept cookies?</div>`);
    expect(rows.map((r) => r.el.id)).toEqual(['n', 'e']);
  });

  it('a hidden block at the top of the page is still hidden when no dialog is open', () => {
    const rows = classify(`<div aria-hidden="true"><label for="a">Email</label><input id="a"><label for="b">Name</label><input id="b"></div>
      <form><label for="n">First name</label><input id="n"></form>`);
    expect(rows.map((r) => r.el.id)).toEqual(['n']);
  });

  it.each(['Email addresses', 'Addresses', 'Linked In', 'Linked In URL', 'Dateofbirth', 'e-mail', 'post code', 'first-name'])('still reads %s', (label) => {
    const rows = classify(`<form><label for="n">Last name</label><input id="n"><label for="f">${label}</label><input id="f"></form>`);
    expect(rows.find((r) => r.el.id === 'f')?.key).toBeTruthy();
  });

  it('a hidden trap is no field, as a box or as a text area', () => {
    const rows = classify(`<form><label for="n">First name</label><input id="n">
      <div aria-hidden="true"><label for="t">Email</label><input id="t"></div>
      <div aria-hidden="true"><label for="a">Email</label><textarea id="a"></textarea></div></form>`);
    expect(rows.map((r) => r.el.id)).toEqual(['n']);
  });

  it.each([
    ['moved far off the page', 'position:absolute;left:-9999px'],
    ['moved far above the page', 'position:fixed;top:-5000px'],
    ['see-through', 'opacity:0'],
    ['with no height', 'height:0;overflow:hidden'],
    ['with no width', 'width:0;overflow:hidden'],
    ['clipped away', 'position:absolute;clip:rect(0, 0, 0, 0)'],
    ['clipped away the newer way', 'position:absolute;clip-path:inset(50%)'],
  ])('a trap %s is no field, on the box or around it', (_name, style) => {
    const around = classify(`<form><label for="n">First name</label><input id="n"><div style="${style}"><label for="t">Email</label><input id="t"><textarea id="a" aria-label="Email"></textarea></div></form>`);
    expect(around.map((r) => r.el.id)).toEqual(['n']);
    const on = classify(`<form><label for="n">First name</label><input id="n"><label for="t">Email</label><input id="t" style="${style}"></form>`);
    expect(on.map((r) => r.el.id)).toEqual(['n']);
  });

  it('a box a little to the left is still a box', () => {
    const rows = classify('<form><div style="position:relative;left:-20px"><label for="t">Email</label><input id="t"></div></form>');
    expect(rows.map((r) => r.el.id)).toEqual(['t']);
  });

  it('answers hidden behind their labels are still answers', () => {
    const rows = classify('<form><div>Gender</div><div><label><input type="radio" name="g" style="opacity:0;position:absolute;left:-9999px">Male</label><label><input type="radio" name="g" style="opacity:0">Female</label></div></form>');
    expect(rows.map((r) => r.key)).toEqual(['basics.gender']);
  });

  it('a phone widget set to another country is given the number with its code', () => {
    const plan = planOf(`<form><label for="n">First name</label><input id="n"><div class="iti"><div class="iti__country-container"><button type="button" class="iti__selected-country" title="United States: +1"></button></div>
      <input id="p" type="tel" aria-label="Phone number"></div></form>`);
    expect(plan.find((s) => s.fieldKey === 'contact.phone')?.intent).toMatchObject({ kind: 'text', text: '+61 412345678' });
  });

  it.each([
    ['+61412345678', '+61', '+61412345678'],
    ['+61412345678', '+86', '+61412345678'],
    ['0412345678', '61', '+61 412345678'],
  ])('a phone widget set to another country gets %s with %s as %s, the code never twice', (phone, code, expected) => {
    document.body.innerHTML = `<form><label for="n">First name</label><input id="n"><div class="iti"><div class="iti__country-container"><button type="button" class="iti__selected-country" title="United States: +1"></button></div>
      <input id="p" type="tel" aria-label="Phone number"></div></form>`;
    const { contexts, classifications } = scanDocument(document);
    const resume = createSampleProfile().resumes.find((x) => x.id === 'sample-en')!;
    resume.contact.phone = phone;
    resume.contact.phoneCountryCode = code;
    const steps = planFill(contexts, classifications, resume, {}).steps;
    expect(steps.find((s) => s.fieldKey === 'contact.phone')?.intent).toMatchObject({ kind: 'text', text: expected });
  });

  it('a phone widget set to the right country, or to none, is given the plain number', () => {
    for (const title of ['Australia: +61', 'Select country']) {
      const plan = planOf(`<form><label for="n">First name</label><input id="n"><div class="iti"><div class="iti__country-container"><button type="button" class="iti__selected-country" title="${title}"></button></div>
        <input id="p" type="tel" aria-label="Phone number"></div></form>`);
      expect(plan.find((s) => s.fieldKey === 'contact.phone')?.intent).toMatchObject({ kind: 'text', text: '0412345678' });
    }
  });

  it('a plain phone box still gets the plain number', () => {
    expect(classify('<form><label for="p">Phone</label><input id="p" type="tel"></form>')[0]?.key).toBe('contact.phone');
  });

  it('does not list the country picker of such a box as a field of its own', () => {
    const rows = classify(`<form><label for="p">Phone</label><div class="PhoneInput">
      <button type="button" role="combobox" aria-haspopup="listbox" aria-label="Select country calling code: United Kingdom">United Kingdom</button>
      <input id="p" type="tel"></div></form>`);
    expect(rows.map((r) => r.el.id)).toEqual(['p']);
  });
});

describe('a box hidden from people', () => {
  it('is not a field, whatever it is named', () => {
    const rows = classify(`<form><label>Name<input name="name"></label>
      <div aria-hidden="true"><label for="hp"></label><input id="hp" name="email" tabindex="-1" type="text"></div></form>`);
    expect(rows.map((r) => r.el.getAttribute('name'))).toEqual(['name']);
  });
});

describe('the words that tell two labels apart', () => {
  it.each([
    ['Current Pay (Annual)', 'Current age'],
    ['Headline', 'Address line'],
    ['Headline', 'Website'],
    ['Asking Pay', 'Asking age'],
  ])('%s is not %s', (a, b) => {
    expect(labelSimilarity(a, b)).toBeLessThan(0.45);
  });

  it.each([
    ['Emial address', 'Email address'],
    ['Post code', 'Postcode'],
    ['First-name', 'First name'],
    ['Telephone number', 'Telephone numbers'],
    ['Preferred cities', 'Preferred city'],
  ])('%s still reads as %s', (a, b) => {
    expect(labelSimilarity(a, b)).toBeGreaterThan(0.8);
  });
});

describe('upload boxes as pages really label them', () => {
  it('reads an accent in a label', () => {
    const rows = classify('<form><input id="cv" type="file"><label for="cv"><div>Attach Résumé / CV</div></label></form>');
    expect(rows[0]?.key).toBe('attachments.resume');
  });

  it('reads the name a wrapping label points at, and not its file count', () => {
    const rows = classify(`<form><span id="n">Résumé</span><div id="c">Total 0 file selected</div>
      <label aria-labelledby="c n"><input type="file" accept=".pdf"><button type="button">Drop or select (.pdf)</button></label></form>`);
    expect(rows[0]).toMatchObject({ key: 'attachments.resume', label: 'Résumé' });
  });

});

describe('the second line of an address', () => {
  it('is left alone, since one street fits the first line', () => {
    const rows = classify(`<form><label for="a1">Address Line 1</label><input id="a1">
      <label for="a2">Address Line 2</label><input id="a2"></form>`);
    expect(rows.find((r) => r.el.id === 'a1')?.key).toBe('contact.addressStreet');
    expect(rows.find((r) => r.el.id === 'a2')?.key).toBeNull();
  });
});

describe('text near a box that is not its label', () => {
  it('skips a validation message of the box before', () => {
    const rows = classify(`<form>
      <h3>Full Name</h3><input name="a">
      <div class="error-container" style="display:none"><span class="error">A full name is required</span></div>
      <h3>Email Address</h3><input name="b" placeholder="Email Address"></form>`);
    expect(rows.find((r) => r.el.getAttribute('name') === 'b')?.label).toBe('Email Address');
  });

  it('skips a shown error message too', () => {
    const rows = classify(`<form><input name="a">
      <div role="alert">A full name is required</div>
      <input name="b"></form>`);
    expect(rows.find((r) => r.el.getAttribute('name') === 'b')?.label).not.toContain('required');
  });
});

describe('words nobody can read do not make a box a newsletter sign-up', () => {
  const found = (html: string) => classify(html).map((c) => c.el.id);
  it.each([
    ['a script beside boxes that stand on the page itself', '<label for="a">Email</label><input id="a"><script>window.subscribe = 1;</script>'],
    ['a style inside the form', '<form><style>.subscribe { color: red }</style><label for="a">Email</label><input id="a"><button>Apply</button></form>'],
    ['a script in the block that holds the box', '<div><script>track("newsletter")</script><label for="a">Email</label><input id="a"><button>Apply</button></div>'],
  ])('%s', (_name, html) => {
    expect(found(html)).toContain('a');
  });

  it('still leaves a sign-up that says so', () => {
    expect(found('<form><p>Subscribe to our newsletter</p><label for="a">Email</label><input id="a"><button>Go</button></form>')).not.toContain('a');
  });
});
