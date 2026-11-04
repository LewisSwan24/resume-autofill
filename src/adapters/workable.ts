import type { AtsAdapter } from './types';

const editor = {
  add: '[data-ui="add-section"]',
  editor: '[data-ui="editor"]',
  save: '[data-ui="save-section"]',
  cancel: '[data-ui="cancel-section"]',
  saved: '[data-ui="group"]',
  addsOnTop: true,
};

export const workable: AtsAdapter = {
  id: 'workable',
  match: {
    urls: ['https://apply.workable.com/*'],
    fingerprints: ['[data-ui="careers-page-content"]'],
  },
  labels: [
    { control: 'textarea[data-ui="summary"]', label: 'Professional summary' },
    // The country picker follows the number when the number says its country.
    { control: 'input[name="phone"][data-intl-tel-input-id]', label: 'Phone with country code' },
  ],
  editors: [
    {
      ...editor,
      section: 'education',
      title: 'Education',
      root: '[data-ui="education"]',
      identity: { school: '[data-ui="school"]', major: '[data-ui="field_of_study"]', degree: '[data-ui="degree"]' },
      fields: ['education.school', 'education.major', 'education.degree', 'education.startDate', 'education.endDate'],
    },
    {
      ...editor,
      section: 'work',
      title: 'Work experience',
      root: '[data-ui="experience"]',
      identity: { company: '[data-ui="company"]', position: '[data-ui="title"]' },
      fields: ['work.position', 'work.company', 'work.description', 'work.startDate', 'work.endDate', 'work.current'],
    },
  ],
  heldFile: { selector: 'button[aria-label^="delete "]', attribute: 'aria-label', prefix: 'delete ' },
  skip: [
    // A resume says what industry is wanted next, not what a past job was in.
    '[data-ui="experience"] input[name="industry"]',
    // A line about yourself that nothing in a resume is written for.
    'input[name="headline"]',
  ],
};
