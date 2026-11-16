// PageUp People ATS adapter: step detection, question labels, and section editors.
import type { AtsAdapter } from './types';

const readStepText = (doc: Document): string | null => {
  const stepEl =
    doc.querySelector('.pu-wizard-step.active, #pu-step-heading, .pageup-step-title') ??
    doc.querySelector('#pu-apply-form h2, .pageup-application h2');
  const text = stepEl?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return text || null;
};

export const pageup: AtsAdapter = {
  id: 'pageup',
  match: {
    urls: ['https://*.pageuppeople.com/*', 'https://careers.*.pageuppeople.com/*'],
    fingerprints: ['#pu-apply-form', '.pageup-application', '[data-pu-application]'],
  },
  stepSignature: readStepText,
  questions: [
    { control: 'input, select, textarea', within: '.pu-question, .form-group', text: '.pu-question-text, .control-label' },
  ],
  editors: [
    {
      section: 'work',
      title: 'Employment History',
      root: '#pu-employment-history, [data-pu-section="work"]',
      add: '.pu-add-btn, button[data-pu-add]',
      editor: '.pu-editor-panel, [role="dialog"]',
      save: '.pu-save-btn, button[data-pu-save]',
      cancel: '.pu-cancel-btn, button[data-pu-cancel]',
      saved: '.pu-saved-card',
      identity: { company: '.pu-company', position: '.pu-position' },
      fields: ['work.company', 'work.position', 'work.startDate', 'work.endDate', 'work.current', 'work.description'],
    },
    {
      section: 'education',
      title: 'Education',
      root: '#pu-education-history, [data-pu-section="education"]',
      add: '.pu-add-btn, button[data-pu-add]',
      editor: '.pu-editor-panel, [role="dialog"]',
      save: '.pu-save-btn, button[data-pu-save]',
      cancel: '.pu-cancel-btn, button[data-pu-cancel]',
      saved: '.pu-saved-card',
      identity: { school: '.pu-school', degree: '.pu-degree' },
      fields: ['education.school', 'education.degree', 'education.major', 'education.startDate', 'education.endDate'],
    },
  ],
  skip: ['input[name="PreferredNameInitials"]'],
};
