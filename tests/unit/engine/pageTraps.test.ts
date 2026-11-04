// Things real application pages do that read as ordinary fields until you look closely.
import { afterEach, describe, expect, it } from 'vitest';
import { labelSimilarity } from '../../../src/dictionary/similarity';
import { planFill } from '../../../src/engine/plan';
import { scanDocument } from '../../../src/engine/scan';
import { createSampleProfile } from '../../../src/schema/samples';

afterEach(() => {
  document.body.innerHTML = '';
});

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

describe('a plain button that opens a list', () => {
  it.each(['Please select', 'Select', 'Select...', 'Choose one', '请选择'])('is a field when it says %s', (prompt) => {
    document.body.innerHTML = `<form><div><div>Gender</div><button type="button"><div>${prompt}</div></button></div></form>`;
    const { contexts } = scanDocument(document);
    expect(contexts[0]?.control).toMatchObject({ kind: 'select', lib: 'aria' });
    expect(contexts[0]?.evidence.map((e) => e.text)).toContain('Gender');
  });

  it.each(['Expand', 'Apply', 'Upload', 'Select file', 'Add another'])('is no field when it says %s', (text) => {
    document.body.innerHTML = `<form><div><div>Gender</div><button type="button"><div>${text}</div></button></div></form>`;
    expect(scanDocument(document).contexts).toHaveLength(0);
  });

  it('is no field when it can submit the form', () => {
    document.body.innerHTML = '<form><div><div>Gender</div><button type="submit">Please select</button></div></form>';
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
