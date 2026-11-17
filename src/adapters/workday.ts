import type { AtsAdapter } from './types';

const field = (name: string): string => `[data-automation-id="formField-${name}"]`;

const readStepText = (doc: Document): string | null => {
  const stepEl =
    doc.querySelector('[data-automation-id="progressBar"] [aria-current="step"]') ??
    doc.querySelector('[data-automation-id="applyFlowPage"] h2');
  const text = stepEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return text || null;
};

export const workday: AtsAdapter = {
  id: 'workday',
  match: {
    urls: ['https://*.myworkdayjobs.com/*', 'https://*.myworkdaysite.com/*'],
    fingerprints: ['[data-automation-id="applyFlowPage"]'],
  },
  stepSignature: readStepText,
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
  editors: [
    {
      section: 'work',
      title: 'Work Experience',
      root: '[data-automation-id="workExperienceSection"]',
      add: '[data-automation-id="add-button"], button[data-automation-id*="Add"]',
      editor: '[data-automation-id="workExperience-panel"], [data-automation-id="workExperienceForm"]',
      save: '[data-automation-id="save-button"], button[data-automation-id*="save"]',
      cancel: '[data-automation-id="cancel-button"], button[data-automation-id*="cancel"]',
      saved: '[data-automation-id="workExperienceItem"], [data-automation-id^="workExperience-"]',
      identity: {
        company: '[data-automation-id="company"], [data-automation-id="companyName"]',
        position: '[data-automation-id="jobTitle"]',
      },
      fields: ['work.position', 'work.company', 'work.city', 'work.startDate', 'work.endDate', 'work.current', 'work.description'],
    },
    {
      section: 'education',
      title: 'Education',
      root: '[data-automation-id="educationSection"]',
      add: '[data-automation-id="add-button"], button[data-automation-id*="Add"]',
      editor: '[data-automation-id="education-panel"], [data-automation-id="educationForm"]',
      save: '[data-automation-id="save-button"], button[data-automation-id*="save"]',
      cancel: '[data-automation-id="cancel-button"], button[data-automation-id*="cancel"]',
      saved: '[data-automation-id="educationItem"], [data-automation-id^="education-"]',
      identity: {
        school: '[data-automation-id="school"]',
        degree: '[data-automation-id="degree"]',
        major: '[data-automation-id="fieldOfStudy"]',
      },
      fields: ['education.school', 'education.degree', 'education.major', 'education.startDate', 'education.endDate', 'education.gpa'],
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
