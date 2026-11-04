import type { AtsAdapter } from './types';

export const lever: AtsAdapter = {
  id: 'lever',
  match: {
    urls: ['https://jobs.lever.co/*', 'https://jobs.eu.lever.co/*'],
    fingerprints: ['li.application-question .application-field'],
  },
  // Questions an employer adds put their text in a plain div beside the control.
  questions: [
    {
      control: '.custom-question input, .custom-question select, .custom-question textarea',
      within: '.application-question',
      text: '.application-label',
    },
  ],
  // The search runs on key presses, and leaving the box with the list up empties it.
  searchBoxes: [
    {
      input: 'input.location-input',
      within: '.application-field',
      option: '.dropdown-location',
      picked: '#selected-location',
    },
  ],
  // Reading an upload ends by writing to contact fields, and always to the picked location.
  uploadBusy: '.resume-upload-working',
};
