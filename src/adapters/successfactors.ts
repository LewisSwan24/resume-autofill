// SAP SuccessFactors Recruiting adapter: multi-step wizard detection and inline entry editors.
import type { AtsAdapter } from './types';

const readStepText = (doc: Document): string | null => {
  const stepEl =
    doc.querySelector('.sf-apply-step.is-active, [data-testid="sf-step-title"], .rcmStepTitle') ??
    doc.querySelector('#rcmApplicationForm h2, .sfApplyForm h2');
  const text = stepEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return text || null;
};

export const successfactors: AtsAdapter = {
  id: 'successfactors',
  match: {
    urls: ['https://*.successfactors.com/*', 'https://*.successfactors.eu/*', 'https://*.sapsf.com/*'],
    fingerprints: ['#rcmApplicationForm', '.sfApplyForm', '[data-testid="sf-application-form"]'],
  },
  stepSignature: readStepText,
  questions: [
    { control: 'input, select, textarea', within: '.sf-form-field, .rcmFieldRow', text: '.sf-form-label, .rcmFieldLabel' },
  ],
  editors: [
    {
      section: 'work',
      title: 'Work Experience',
      root: '[data-sf-section="work"], .sf-work-history',
      add: '[data-sf-action="add"], button.sf-add-entry',
      editor: '.sf-entry-editor, [role="dialog"]',
      save: '[data-sf-action="save"], button.sf-save-entry',
      cancel: '[data-sf-action="cancel"], button.sf-cancel-entry',
      saved: '.sf-entry-card',
      identity: { company: '.sf-entry-company', position: '.sf-entry-title' },
      fields: ['work.company', 'work.position', 'work.startDate', 'work.endDate', 'work.current', 'work.description'],
    },
    {
      section: 'education',
      title: 'Education',
      root: '[data-sf-section="education"], .sf-education-history',
      add: '[data-sf-action="add"], button.sf-add-entry',
      editor: '.sf-entry-editor, [role="dialog"]',
      save: '[data-sf-action="save"], button.sf-save-entry',
      cancel: '[data-sf-action="cancel"], button.sf-cancel-entry',
      saved: '.sf-entry-card',
      identity: { school: '.sf-entry-school', degree: '.sf-entry-degree' },
      fields: ['education.school', 'education.degree', 'education.major', 'education.startDate', 'education.endDate'],
    },
  ],
  skip: ['input[name="middleName"]', 'input[name="salutation"]'],
};
