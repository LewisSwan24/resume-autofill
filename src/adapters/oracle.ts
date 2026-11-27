import type { AtsAdapter } from './types';

// Oracle Recruiting Cloud (Candidate Experience) draws its form in steps, with pickers of its own that the ARIA
// combobox driver reads. What the engine cannot: the phone row's label points at the country-code picker, and the
// number box beside it is named only "Phone Number" by aria-label, so each is named for what it holds.
export const oracle: AtsAdapter = {
  id: 'oracle',
  match: {
    urls: ['https://*.oraclecloud.com/hcmUI/CandidateExperience/*'],
    fingerprints: ['form.apply-flow__content-form apply-flow-section'],
  },
  labels: [
    { control: 'input[id^="country-codes-dropdown"][role="combobox"]', label: 'Phone country code' },
    { control: 'input.phone-row__input', label: 'Phone' },
  ],
};
