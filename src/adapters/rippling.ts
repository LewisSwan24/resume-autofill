import type { AtsAdapter } from './types';

export const rippling: AtsAdapter = {
  id: 'rippling',
  match: {
    urls: ['https://ats.rippling.com/*'],
    fingerprints: ['[data-testid="field"] input[data-input][data-testid^="input-"]'],
  },
  // Once it has stored an uploaded resume, the page reads it: every field is locked, a notice shows under the
  // resume box, and what it found is written over the fields when it is done. The notice names itself in the
  // page's language, so the locked fields are the sign in any other.
  uploadBusy: '[role="alert"][data-testid^="Parsing the r"], [data-testid="field"] input[data-input]:disabled',
  // Storing comes first: a request for a storage form, the file itself, and two checks that it arrived.
  uploadSignMs: 6_000,
};
