import type { AtsAdapter } from './types';

// Jobvite draws a plain labelled form, which the engine reads by itself, except for the files. The resume and the
// cover letter each have an "Add" button that opens a menu; the menus sit closed at the end of the page, each with
// a file box and a box to paste into instead. The file box is named after the paste box beside it, and the buttons
// that open the menus are no fields of their own.
export const jobvite: AtsAdapter = {
  id: 'jobvite',
  match: {
    urls: ['https://jobs.jobvite.com/*/job/*'],
    fingerprints: ['form[name="scopeData.applyForm"]'],
  },
  labels: [
    { control: '.jv-add-attachment:has(textarea[placeholder*="Resume"]) input[type="file"]', label: 'Resume' },
    { control: '.jv-add-attachment:has(textarea[placeholder*="Cover Letter"]) input[type="file"]', label: 'Cover letter' },
  ],
  skip: ['button[jv-add-attachment]'],
};
