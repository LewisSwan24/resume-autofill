import type { AtsAdapter } from './types';

const field = (name: string): string => `[data-automation-id="formField-${name}"]`;

export const workday: AtsAdapter = {
  id: 'workday',
  match: {
    urls: ['https://*.myworkdayjobs.com/*', 'https://*.myworkdaysite.com/*'],
    fingerprints: ['[data-automation-id="applyFlowPage"]'],
  },
  prompts: [
    {
      input: '[data-automation-id="multiSelectContainer"] input',
      within: '[data-automation-id="multiSelectContainer"]',
      list: '[data-automation-id="activeListContainer"]',
      option: '[role=option]',
      leaf: '[data-automation-id="promptLeafNode"]',
      chosen: '[data-automation-id="selectedItem"] [data-automation-id="promptOption"]',
    },
  ],
  // Nothing in a resume answers these, and the page has already set the phone type.
  skip: [
    `${field('preferredCheck')} input`,
    `${field('legalName--middleName')} input`,
    `${field('phoneType')} button`,
    `${field('extension')} input`,
  ],
};
