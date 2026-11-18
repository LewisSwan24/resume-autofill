// Adapters for major Chinese campus/social recruitment portals (ByteDance/Feishu Jobs, Nowcoder, Boss/Tencent).
import type { AtsAdapter } from './types';

export const bytedanceCampus: AtsAdapter = {
  id: 'bytedance',
  match: {
    urls: ['https://jobs.bytedance.com/*', 'https://campus.bytedance.com/*'],
    fingerprints: ['.atsx-apply-form', '[data-bytedance-apply]', '.ud-formily-item'],
  },
  stepSignature: (doc) => {
    const active = doc.querySelector('.atsx-step-active, .ud-steps-item-active .ud-steps-item-title');
    return active?.textContent?.replace(/\s+/g, ' ').trim() || null;
  },
  questions: [
    {
      control: 'input, select, textarea, [role="combobox"]',
      within: '.atsx-form-item, .ud-formily-item',
      text: '.atsx-form-label, .ud-formily-item-label label',
    },
  ],
};

export const nowcoderCampus: AtsAdapter = {
  id: 'nowcoder',
  match: {
    urls: ['https://*.nowcoder.com/jobs/*', 'https://nowcoder.com/jobs/*'],
    fingerprints: ['.nc-resume-form', '[data-nc-apply-form]'],
  },
  questions: [
    {
      control: 'input, select, textarea',
      within: '.nc-form-row, .nc-question-item',
      text: '.nc-form-label, .nc-question-title',
    },
  ],
};

export const tencentCareers: AtsAdapter = {
  id: 'tencent',
  match: {
    urls: ['https://join.qq.com/*', 'https://careers.tencent.com/*'],
    fingerprints: ['.qq-apply-form', '.join-resume-container'],
  },
  stepSignature: (doc) => {
    const active = doc.querySelector('.join-step-active, .tx-step.is-active');
    return active?.textContent?.replace(/\s+/g, ' ').trim() || null;
  },
  questions: [
    {
      control: 'input, select, textarea',
      within: '.join-field-item, .tx-form-item',
      text: '.join-field-label, .tx-form-label',
    },
  ],
};
