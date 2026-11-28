// Zoho Recruit: forms drawn with its own Lyte components, whose labels sit beside their controls, never tied to them.
import { afterEach, describe, expect, it } from 'vitest';
import { ADAPTERS } from '../../../src/adapters';
import { resolveAdapter } from '../../../src/adapters/resolve';
import { scanDocument } from '../../../src/engine/scan';
import { zohoForm } from '../../shared/zohoForm';

afterEach(() => {
  document.body.replaceChildren();
});

const at = (href: string) => resolveAdapter(document, ADAPTERS, href)?.id ?? null;

function scanned() {
  const scan = scanDocument(document);
  const find = (selector: string) => {
    const el = document.querySelector(selector);
    const i = scan.contexts.findIndex((c) => c.control.el === el || (el !== null && c.control.el.contains(el)));
    return i < 0 ? null : { control: scan.contexts[i]!.control, key: scan.classifications[i]!.fieldKey };
  };
  return { scan, find };
}

describe('Zoho Recruit', () => {
  it('is known by its career pages, and by its components on a domain of its own', () => {
    expect(at('https://acme.zohorecruit.com.au/jobs/Careers/1/Analyst?source=CareerSite')).toBe('zoho');
    expect(at('https://acme.zohorecruit.com/jobs/Careers/1/Analyst')).toBe('zoho');
    document.body.innerHTML = zohoForm();
    expect(at('https://careers.example.com/jobs/1')).toBe('zoho');
  });

  it('is not taken for a page that only mentions it', () => {
    expect(at('https://example.com/blog/zohorecruit.com/jobs')).toBeNull();
    document.body.innerHTML = '<form><label>First Name<input name="first"></label></form>';
    expect(at('https://careers.example.com/jobs/1')).toBeNull();
  });

  it('reads each box by the label of its row', () => {
    document.body.innerHTML = zohoForm();
    const { find } = scanned();
    expect(find('input[name="rec-form_101"]')?.key).toBe('basics.givenName');
    expect(find('input[name="rec-form_102"]')?.key).toBe('basics.familyName');
    expect(find('input[name="rec-form_104"]')?.key).toBe('contact.phone');
    expect(find('input[name="rec-form_106"]')?.key).toBe('contact.addressStreet');
  });

  it('reads the list before the first name as the salutation, and the list in the phone row as its country code', () => {
    document.body.innerHTML = zohoForm();
    const { find } = scanned();
    const salutation = find('[data-zcqa="rec_Salutation"] lyte-dropdown');
    expect(salutation?.control.kind).toBe('select');
    expect(salutation?.key).not.toBe('basics.givenName');
    expect(find('[data-zcqa="rec_Mobile"] lyte-dropdown')?.key).toBe('contact.phoneCountryCode');
  });

  it('takes its lists as Lyte lists, one that holds several as such', () => {
    document.body.innerHTML = zohoForm();
    const { find } = scanned();
    const rights = find('[data-zcqa="rec_Working_rights_in_Australia"] lyte-dropdown');
    expect(rights?.control).toMatchObject({ lib: 'lyte', kind: 'select', multiple: true });
    expect(rights?.key).toBe('workRights.status');
    expect(find('[data-zcqa="rec_Salutation"] lyte-dropdown')?.control).toMatchObject({ lib: 'lyte', kind: 'select' });
  });

  it('takes the city, state and postcode boxes that suggest places as text boxes', () => {
    document.body.innerHTML = zohoForm();
    const { find } = scanned();
    for (const [zcqa, key] of [
      ['rec_City', 'contact.addressCity'],
      ['rec_State', 'contact.addressProvince'],
      ['rec_Zip_Code', 'contact.postcode'],
    ] as const) {
      const box = find(`[data-zcqa="${zcqa}"] input`);
      expect(box?.control.kind, zcqa).toBe('text');
      expect(box?.key, zcqa).toBe(key);
    }
  });

  it('counts each control once', () => {
    document.body.innerHTML = zohoForm();
    const { scan } = scanned();
    // Salutation, first and last name, email, phone code and number, work rights, street, city, state, postcode, country.
    expect(scan.contexts).toHaveLength(12);
  });
});
