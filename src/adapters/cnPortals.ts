// Adapters for Chinese campus/social recruitment portals: the hosted systems many companies use (Moka, Beisen,
// Feishu) and a few companies' own sites (ByteDance, Nowcoder, Tencent).
import { isVisible } from '../engine/visibility';
import type { AtsAdapter } from './types';

// ByteDance's own site runs the recruiting system it sells as Feishu, so the two read their forms the same way.
const udStep = (doc: Document): string | null => {
  const active = doc.querySelector('.atsx-step-active, .ud-steps-item-active .ud-steps-item-title');
  return active?.textContent?.replace(/\s+/g, ' ').trim() || null;
};
const udQuestions: AtsAdapter['questions'] = [
  {
    control: 'input, select, textarea, [role="combobox"]',
    within: '.atsx-form-item, .ud-formily-item',
    text: '.atsx-form-label, .ud-formily-item-label label',
  },
];

export const bytedanceCampus: AtsAdapter = {
  id: 'bytedance',
  match: {
    urls: ['https://jobs.bytedance.com/*', 'https://campus.bytedance.com/*'],
    fingerprints: ['.atsx-apply-form', '[data-bytedance-apply]', '.ud-formily-item'],
  },
  stepSignature: udStep,
  questions: udQuestions,
};

const MOKA_STEP = /^Step:\s*\d+\s*\/\s*\d+$/;

/**
 * Moka (app.mokahr.com and companies' own domains). On a desktop the form is one page that ends in 预览并提交. On a
 * phone (/m/...) each block is a step: all of them are on the page, the one showing says "Step: n/N", and a footer
 * button says 下一步 until the last step, where it sends. Uploading a resume makes the page read it and write what it
 * found into the form; its resume button spins until then. Class names end in a build hash, so they go by prefix.
 */
export const moka: AtsAdapter = {
  id: 'moka',
  match: {
    urls: ['https://*.mokahr.com/*'],
    fingerprints: ['#moka-version'],
  },
  stepSignature: (doc) => {
    const counters = doc.querySelectorAll<HTMLElement>('.mobile-layout__content [class*="count-"]');
    for (const el of Array.from(counters)) {
      const text = el.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (MOKA_STEP.test(text) && isVisible(el)) return text;
    }
    return null;
  },
  nextButton: '.mobile-layout__footer button',
  uploadBusy: '.file_upload [class*="sd-Loading-"]',
  // On a phone a field's title is a span, not a <label>, and the company's own questions sit in 基本信息: read the
  // title as the question so 是否接收组织调配 or 语言技能 is not held back as a stray guess there.
  questions: [
    {
      control: 'input, textarea, [contenteditable]',
      within: '.mobile-layout__content [class*="applyField-"]',
      text: '[class*="title-info-"] > [class*="title-"]',
    },
  ],
};

/**
 * Beisen (北森, *.zhiye.com and companies' own domains): Phoenix widgets in a one-page resume form. No page seen
 * yet has steps or reads an uploaded resume, so there is nothing to say about either.
 */
export const beisen: AtsAdapter = {
  id: 'beisen',
  match: {
    urls: ['https://*.zhiye.com/*'],
    fingerprints: ['.form-item--phoenix', '.phoenix-unmodeled-layer .phoenix-select'],
  },
};

/** Feishu recruiting (*.jobs.feishu.cn, and /index/m/ on a phone). Its forms are the ones ByteDance's site uses. */
export const feishu: AtsAdapter = {
  id: 'feishu',
  match: {
    urls: ['https://*.jobs.feishu.cn/*'],
    fingerprints: ['.ud-formily-item', '.atsx-form .atsx-form-item'],
  },
  stepSignature: udStep,
  questions: udQuestions,
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
