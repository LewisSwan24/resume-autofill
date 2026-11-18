// SmartRecruiters ATS adapter: One-Click Apply widgets, Web Components, and entry editors.
import { querySelectorDeep } from '../engine/shadow';
import type { AtsAdapter } from './types';

const readStepText = (doc: Document): string | null => {
  const el =
    querySelectorDeep(doc, '.sr-step.active, [data-test="wizard-step-active"], oc-application-step[active]') ??
    querySelectorDeep(doc, 'oc-application-form h2, [data-test="application-form"] h2');
  const text = el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return text || null;
};

export const smartrecruiters: AtsAdapter = {
  id: 'smartrecruiters',
  match: {
    urls: ['https://jobs.smartrecruiters.com/*', 'https://*.smartrecruiters.com/*'],
    fingerprints: ['oc-application-form', '[data-test="application-form"]', 'spl-dropzone'],
  },
  stepSignature: readStepText,
  questions: [
    {
      control: 'input, select, textarea, [role="combobox"]',
      within: '[data-test="screening-question"], .sr-form-group, spl-form-field',
      text: '[data-test="question-label"], .sr-question-label, label',
    },
  ],
  editors: [
    {
      section: 'work',
      title: 'Experience',
      root: '[data-test="experience-section"], .sr-experience-section',
      add: '[data-test="add-experience"], button.sr-add-experience',
      editor: '[data-test="experience-editor"], .sr-editor-modal',
      save: '[data-test="save-experience"], button.sr-save',
      cancel: '[data-test="cancel-experience"], button.sr-cancel',
      saved: '[data-test="experience-card"], .sr-saved-entry',
      identity: { company: '[data-test="entry-company"], .sr-company', position: '[data-test="entry-title"], .sr-title' },
      fields: ['work.company', 'work.position', 'work.city', 'work.startDate', 'work.endDate', 'work.current', 'work.description'],
    },
    {
      section: 'education',
      title: 'Education',
      root: '[data-test="education-section"], .sr-education-section',
      add: '[data-test="add-education"], button.sr-add-education',
      editor: '[data-test="education-editor"], .sr-editor-modal',
      save: '[data-test="save-education"], button.sr-save',
      cancel: '[data-test="cancel-education"], button.sr-cancel',
      saved: '[data-test="education-card"], .sr-saved-entry',
      identity: { school: '[data-test="entry-school"], .sr-school', major: '[data-test="entry-major"], .sr-major' },
      fields: ['education.school', 'education.degree', 'education.major', 'education.startDate', 'education.endDate', 'education.current'],
    },
  ],
  uploadBusy: 'spl-dropzone[uploading], [data-test="resume-parsing"]',
};
