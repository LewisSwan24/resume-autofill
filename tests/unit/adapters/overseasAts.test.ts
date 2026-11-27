// Adapters for overseas ATS whose application pages are public: Personio, BambooHR, Jobvite, JazzHR, Oracle.
import { afterEach, describe, expect, it } from 'vitest';
import { ADAPTERS } from '../../../src/adapters';
import { resolveAdapter } from '../../../src/adapters/resolve';
import { scanDocument } from '../../../src/engine/scan';

afterEach(() => {
  document.body.replaceChildren();
});

const at = (href: string) => resolveAdapter(document, ADAPTERS, href)?.id ?? null;

describe('Personio', () => {
  it('is known by its job pages on either domain', () => {
    expect(at('https://acme.jobs.personio.de/job/123456/apply?language=en')).toBe('personio');
    expect(at('https://acme-gmbh.jobs.personio.com/job/123456?display=en#apply')).toBe('personio');
  });

  it('is known by its form on a company domain of its own', () => {
    document.body.innerHTML = `<form><div role="group"><button type="button">Add file</button>
      <input id="doc-input-cv" type="file" name="documents.cv"></div></form>`;
    expect(at('https://careers.example.com/job/123456/apply')).toBe('personio');
  });

  it('is not taken for a page that only mentions it', () => {
    expect(at('https://example.com/blog/personio.jobs.personio.de')).toBeNull();
    document.body.innerHTML = '<form><input type="file" name="documents"></form>';
    expect(at('https://careers.example.com/apply')).toBeNull();
  });

  it('reads the Remove button of a file it lists as the file it holds', () => {
    const personio = ADAPTERS.find((a) => a.id === 'personio');
    expect(personio?.heldFile).toEqual({ selector: 'button[aria-label^="Remove "]', attribute: 'aria-label', prefix: 'Remove ' });
  });
});

describe('BambooHR', () => {
  // The form as BambooHR's own components draw it, cut down: a text box, a select of its own (a button that opens
  // a listbox, beside a hidden stand-in select holding only the choice), and the resume box under a line of text.
  const textField = (id: string, name: string, label: string) =>
    `<div data-fabric-component="TextField InputWrapper"><div><label for="${id}">${label}</label></div>
      <div><input id="${id}" name="${name}" type="text"></div></div>`;
  const selectField = (n: number, name: string, label: string, shown: string) =>
    `<div data-fabric-component="SelectField InputWrapper"><div><label for="fab-select${n}">${label}<span aria-hidden="true"> *</span></label></div>
      <div><div data-fabric-component="Select"><div><button type="button" aria-haspopup="listbox" aria-expanded="false"
        aria-label="${label} ${shown}"><div>${shown}</div></button></div>
      <select aria-hidden="true" id="fab-select${n}" name="${name}" tabindex="-1"><option value="1"></option></select></div></div></div>`;
  const FORM = `<form>
    ${textField('firstName', 'firstName', 'First Name')}
    ${textField('FabricTextField-64', 'streetAddress.value', 'Address')}
    ${textField('FabricTextField-65', 'city.value', 'City')}
    ${selectField(66, 'state.value', 'State', '–Select–')}
    ${selectField(68, 'countryId.value', 'Country', 'United States')}
    <div data-fabric-component="Flex"><p data-fabric-component="BodyText">Resume*</p>
      <div data-fabric-component="FileUpload"><div data-fabric-component="FileUploadInput">
        <button type="button">Choose File*</button><input aria-label="file-input" type="file"></div>
      <input name="resumeFileId" type="hidden" value=""></div></div>
  </form>`;

  const classified = () => {
    const scan = scanDocument(document);
    return (selector: string) => {
      const el = document.querySelector(selector);
      const i = scan.contexts.findIndex((c) => c.control.el === el);
      return i < 0 ? null : { fieldKey: scan.classifications[i]!.fieldKey, label: scan.contexts[i]!.evidence[0]?.text };
    };
  };

  it('is known by its careers pages, and by its own components on a page of its own', () => {
    expect(at('https://acme.bamboohr.com/careers/30')).toBe('bamboohr');
    document.body.innerHTML = FORM;
    expect(at('https://careers.example.com/jobs/30')).toBe('bamboohr');
  });

  it("names its own selects by their field's title, not with the choice they show", () => {
    document.body.innerHTML = FORM;
    const at = classified();
    expect(at('[data-fabric-component="Select"]:has(#fab-select68) button')).toMatchObject({
      fieldKey: 'contact.addressCountry',
    });
    expect(at('[data-fabric-component="Select"]:has(#fab-select66) button')).toMatchObject({ fieldKey: 'contact.addressProvince' });
  });

  it('leaves the hidden stand-in selects out', () => {
    document.body.innerHTML = FORM;
    const at = classified();
    expect(at('#fab-select66')).toBeNull();
    expect(at('#fab-select68')).toBeNull();
  });

  it('reads the resume box by the line above it, and the address line as the street', () => {
    document.body.innerHTML = FORM;
    const at = classified();
    expect(at('input[type="file"]')).toMatchObject({ fieldKey: 'attachments.resume' });
    expect(at('input[name="streetAddress.value"]')).toMatchObject({ fieldKey: 'contact.addressStreet' });
    expect(at('input[name="city.value"]')).toMatchObject({ fieldKey: 'contact.addressCity' });
  });
});

describe('JazzHR', () => {
  // The form as JazzHR serves it, cut down: one "Address" label over four boxes, the last three named only by
  // their placeholders, and the resume box behind an "Attach resume" link.
  const box = (key: string, placeholder: string) =>
    `<input type="text" id="resumator-${key}-value" name="resumator-${key}-value" class="form-control" placeholder="${placeholder}">`;
  const FORM = `<form id="form_submit_new_resume" method="POST">
    <div class="form-group"><label for="resumator-firstname-value">First Name<i class="asterisk">*</i></label>
      <input type="text" id="resumator-firstname-value" name="resumator-firstname-value" class="form-control"></div>
    <div class="form-group" id="resumator-address"><label for="resumator-address-value">Address</label>
      <div class="resumator-input">${box('address', 'Address')}
        <div class="row"><div class="col">${box('city', 'City')}</div><div class="col">${box('state', 'State/Province')}</div>
        <div class="col">${box('postal', 'Postal')}</div></div></div></div>
    <div id="resumator-resume" class="form-group"><label for="resumator-resume-value">Resume<i class="asterisk">*</i></label>
      <div class="resumator-input"><input type="file" id="resumator-resume-value" name="resumator-resume-value"></div></div>
  </form>`;

  const classified = () => {
    const scan = scanDocument(document);
    return (selector: string) => {
      const el = document.querySelector(selector);
      const i = scan.contexts.findIndex((c) => c.control.el === el);
      return i < 0 ? null : scan.classifications[i]!.fieldKey;
    };
  };

  it('is known by its apply pages, and by its form on a company domain of its own', () => {
    expect(at('https://acme.applytojob.com/apply/AbC123xYz/Junior-Analyst')).toBe('jazzhr');
    document.body.innerHTML = FORM;
    expect(at('https://careers.example.com/jobs/junior-analyst')).toBe('jazzhr');
  });

  it('is not taken for a page that only mentions it', () => {
    expect(at('https://example.com/blog/applytojob.com/apply')).toBeNull();
    document.body.innerHTML = '<form><input type="text" id="firstname" name="firstname"></form>';
    expect(at('https://careers.example.com/apply')).toBeNull();
  });

  it('reads the four boxes under "Address" as street, city, state and postcode', () => {
    document.body.innerHTML = FORM;
    const key = classified();
    expect(key('#resumator-address-value')).toBe('contact.addressStreet');
    expect(key('#resumator-city-value')).toBe('contact.addressCity');
    expect(key('#resumator-state-value')).toBe('contact.addressProvince');
    expect(key('#resumator-postal-value')).toBe('contact.postcode');
  });

  it('reads the resume box by its label', () => {
    document.body.innerHTML = FORM;
    expect(classified()('#resumator-resume-value')).toBe('attachments.resume');
  });
});
