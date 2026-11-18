// Ashby ATS adapter: custom application fields, yes/no button strips, and wizard step tracking.
import type { AtsAdapter } from './types';

const readStepText = (doc: Document): string | null => {
  const el =
    doc.querySelector('[data-ashby-step-active], .ashby-application-form-step.active, [class*="ashby-step-active"]') ??
    doc.querySelector('.ashby-application-form-container h2, [data-ashby-form] h2');
  const text = el?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  return text || null;
};

export const ashby: AtsAdapter = {
  id: 'ashby',
  match: {
    urls: ['https://jobs.ashbyhq.com/*', 'https://*.ashbyhq.com/*'],
    fingerprints: ['[data-ashby-form]', '.ashby-application-form-container', '[class*="ashby-application-form"]'],
  },
  stepSignature: readStepText,
  questions: [
    {
      control: 'input, select, textarea, [role="radiogroup"], .raf-answer-buttons',
      within: '.ashby-application-form-field-entry, [data-ashby-field]',
      text: '.ashby-application-form-question-title, label, [class*="fieldTitle"]',
    },
  ],
  uploadBusy: '[data-ashby-uploading="true"], .ashby-file-uploading',
};
