import type { AtsAdapter } from './types';

// Zoho Recruit draws its form with its own Lyte components. What the engine cannot read by itself:
// - Each row's label sits beside its control and is tied to none; the boxes are named only rec-form_<number>.
// - The first-name row starts with a salutation list, and the phone row with a list of country codes.
// The lists themselves are Lyte lists (see drivers/lyte.ts); city, state and postcode suggest places but keep what
// is typed, so they are text boxes.
const ROW_CONTROLS = 'crux-text-component input, crux-phone-component input, crux-picklist-component lyte-dropdown';

export const zoho: AtsAdapter = {
  id: 'zoho',
  match: {
    urls: ['https://*.zohorecruit.com/*', 'https://*.zohorecruit.com.au/*', 'https://*.zohorecruit.eu/*', 'https://*.zohorecruit.in/*'],
    fingerprints: ['.crc-form-row crux-text-component', '.crc-form-row crux-picklist-component'],
  },
  questions: [{ control: ROW_CONTROLS, within: '.crc-form-row', text: ':scope > label .crc-label-text > span:first-child' }],
  labels: [
    { control: '[data-zcqa="rec_Salutation"] lyte-dropdown', label: 'Salutation' },
    { control: 'crux-phone-component lyte-dropdown', label: 'Mobile country code' },
  ],
};
