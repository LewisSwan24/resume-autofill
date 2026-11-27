import type { AtsAdapter } from './types';

// JazzHR serves a plain form whose boxes are all named `resumator-<what>-value`. The engine reads most of it; what
// it cannot: one "Address" label stands over four boxes, and the last three are named only by placeholders, so
// the first reads as the whole address and the rest as guesses. Each gets the name of what it holds.
export const jazzhr: AtsAdapter = {
  id: 'jazzhr',
  match: {
    urls: ['https://*.applytojob.com/apply/*'],
    fingerprints: ['input#resumator-firstname-value[name="resumator-firstname-value"]'],
  },
  labels: [
    { control: '#resumator-address-value', label: 'Street address' },
    { control: '#resumator-city-value', label: 'City' },
    { control: '#resumator-state-value', label: 'State/Province' },
    { control: '#resumator-postal-value', label: 'Postcode' },
  ],
};
