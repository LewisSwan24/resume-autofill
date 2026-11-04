import type { AtsAdapter } from './types';

export const greenhouse: AtsAdapter = {
  id: 'greenhouse',
  match: {
    urls: ['https://*.greenhouse.io/*'],
    // Many employers embed the same form on their own site.
    fingerprints: ['.phone-input__country'],
  },
  // Labelled just "Country", but it picks the dialling code of the phone number beside it.
  labels: [{ control: '.phone-input__country input', label: 'Phone country code' }],
};
