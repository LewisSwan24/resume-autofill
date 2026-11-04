// Things real application pages do that read as ordinary fields until you look closely.
import { afterEach, describe, expect, it } from 'vitest';
import { labelSimilarity } from '../../../src/dictionary/similarity';
import { scanDocument } from '../../../src/engine/scan';

afterEach(() => {
  document.body.innerHTML = '';
});

function classify(html: string): { label: string; key: string | null; el: HTMLElement }[] {
  document.body.innerHTML = html;
  const { contexts, classifications } = scanDocument(document);
  return contexts.map((c, i) => ({ label: c.evidence[0]?.text ?? '', key: classifications[i]?.fieldKey ?? null, el: c.control.el }));
}

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
