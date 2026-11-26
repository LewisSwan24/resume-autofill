import type { AtsAdapter } from './types';

// The general engine reads Personio's form as it is. What it cannot see: a file the page took lists it with a
// Remove button of its own and empties the file box.
export const personio: AtsAdapter = {
  id: 'personio',
  match: {
    urls: ['https://*.jobs.personio.de/*', 'https://*.jobs.personio.com/*'],
    // A company's own careers domain in front of the same form.
    fingerprints: ['input[type="file"][id^="doc-input-"][name^="documents."]'],
  },
  heldFile: { selector: 'button[aria-label^="Remove "]', attribute: 'aria-label', prefix: 'Remove ' },
};
