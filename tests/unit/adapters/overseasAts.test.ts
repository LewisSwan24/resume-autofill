// Adapters for overseas ATS whose application pages are public: Personio, BambooHR, Jobvite, JazzHR, Oracle.
import { afterEach, describe, expect, it } from 'vitest';
import { ADAPTERS } from '../../../src/adapters';
import { resolveAdapter } from '../../../src/adapters/resolve';

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
