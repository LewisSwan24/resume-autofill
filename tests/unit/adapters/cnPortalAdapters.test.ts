// Moka, Beisen and Feishu: found by address and by their own markup, with how each tells its steps apart, where
// its Next button is, and what it shows while it reads an uploaded resume.
import { afterEach, describe, expect, it } from 'vitest';
import { ADAPTERS } from '../../../src/adapters';
import { resolveAdapter } from '../../../src/adapters/resolve';
import { runAutoAdvance, type AdvanceDeps } from '../../../src/background/autoAdvance';
import { createStepHandlers } from '../../../src/content/steps';
import { FILL_THRESHOLD } from '../../../src/engine/classify';
import { scanDocument } from '../../../src/engine/scan';
import { findStepAction, stepFingerprint } from '../../../src/fill/nextStep';
import { BEISEN_FORM } from '../../shared/beisenForm';
import { FEISHU_DESKTOP_ENTRIES } from '../../shared/feishuDesktopForm';
import { FEISHU_FORM } from '../../shared/feishuForm';
import { FEISHU_MOBILE_FORM } from '../../shared/feishuMobileForm';
import { MOKA_FORM, MOKA_MARKER, MOKA_SUBMIT, mokaMobileSteps, mokaResumeUpload } from '../../shared/mokaForm';

afterEach(() => {
  document.body.replaceChildren();
});

const OWN_DOMAIN = 'https://careers.example.test/apply';
const idAt = (href: string, html = '') => {
  document.body.innerHTML = html;
  return resolveAdapter(document, ADAPTERS, href)?.id ?? null;
};

describe('Moka', () => {
  it('is found on its host, desktop and phone, with the route after the #', () => {
    expect(idAt('https://app.mokahr.com/campus-recruitment/acme/100001#/job/0000-aaaa/apply')).toBe('moka');
    expect(idAt('https://app.mokahr.com/m/campus-recruitment/acme/100001#/candidateApply/0000-aaaa')).toBe('moka');
    expect(idAt('https://app.mokahr.com.evil.test/campus-recruitment/acme/1')).toBeNull();
  });

  it('is found on a company domain by the version tag every Moka page carries', () => {
    expect(idAt(OWN_DOMAIN, MOKA_FORM)).toBeNull();
    expect(idAt(OWN_DOMAIN, MOKA_MARKER + MOKA_FORM)).toBe('moka');
  });

  it('waits while the resume box spins, and not before', () => {
    const moka = ADAPTERS.find((a) => a.id === 'moka')!;
    document.body.innerHTML = MOKA_FORM + mokaResumeUpload(false);
    expect(document.querySelectorAll(moka.uploadBusy!)).toHaveLength(0);
    document.body.innerHTML = MOKA_FORM.replace(/<div class="file_upload">.*?<\/div>/, mokaResumeUpload(true));
    expect(document.querySelectorAll(moka.uploadBusy!)).toHaveLength(1);
  });

  it('has one step on a desktop, and names none of its buttons as Next there', () => {
    document.body.innerHTML = MOKA_MARKER + MOKA_FORM + MOKA_SUBMIT;
    const moka = resolveAdapter(document, ADAPTERS, OWN_DOMAIN)!;
    expect(moka.stepSignature!(document)).toBeNull();
    expect(document.querySelectorAll(moka.nextButton!)).toHaveLength(0);
  });

  const steps = [
    { title: '申请信息', fields: ['推荐码'] },
    { title: '个人信息', fields: ['姓名', '邮箱'] },
    { title: '更新说明', fields: [] },
  ];

  it('names a phone step by its counter, and finds the footer button', () => {
    const page = mokaMobileSteps(steps);
    document.body.innerHTML = page.html;
    page.wire(document, () => undefined);
    const moka = resolveAdapter(document, ADAPTERS, OWN_DOMAIN)!;
    expect(moka.stepSignature!(document)).toBe('Step: 1/3');
    const first = findStepAction(document, moka.nextButton);
    expect(first.kind).toBe('next');
    if (first.kind === 'next') first.button.click();
    expect(moka.stepSignature!(document)).toBe('Step: 2/3');
    expect(stepFingerprint(document, moka.stepSignature!(document))).toBe('step:Step: 2/3');
  });

  it('takes its footer button over a Next button somewhere else on the page', () => {
    const page = mokaMobileSteps(steps);
    document.body.innerHTML = page.html + '<button type="button">继续</button>';
    const moka = resolveAdapter(document, ADAPTERS, OWN_DOMAIN)!;
    expect(findStepAction(document).kind).toBe('ambiguous');
    const own = findStepAction(document, moka.nextButton);
    expect(own.kind === 'next' && own.button.closest('.mobile-layout__footer')).toBeTruthy();
  });

  it('on a phone, reads a question asked inside 基本信息 as the label of its list, so it is filled', () => {
    // The phone puts the company's own questions in the 基本信息 block, titled by a span that is no <label>.
    const list = (kind: string, title: string) =>
      `<div class="applyField-Uxo0YVBxOp "><div class="title-info-Bb7QUC5Eao"><span class="title-VjPF9BH7ee"><span>${title}</span></span><span class="sd-Icon-container-1njYU required-XDAMDlWuLZ"></span></div><div class="${kind}"><input class="" placeholder="请选择" readonly=""><div class="fade-gradient"></div></div><div class="describe-Px7yQoZJQ_"></div></div>`;
    const page = mokaMobileSteps([{ title: '基本信息', fields: ['姓名', '邮箱', '民族'] }]);
    document.body.innerHTML = page.html.replace(
      '</div></div></div></div><div class="mobile-layout__footer',
      `${list('bool_info', '是否接收组织调配')}${list('multi_select_info', '语言技能')}</div></div></div></div><div class="mobile-layout__footer`,
    );
    const scan = scanDocument(document);
    const at = (label: string) => {
      const i = scan.contexts.findIndex((c) => c.control.el.closest('[class*="applyField-"]')?.textContent?.includes(label));
      return scan.classifications[i]!;
    };
    expect(at('是否接收组织调配').fieldKey).toBe('jobIntention.acceptAdjustment');
    expect(at('是否接收组织调配').confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
    expect(at('语言技能').fieldKey).toBe('languages.language');
    expect(at('语言技能').confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
    // The block's own title is not a question: 姓名 keeps its own label.
    expect(at('姓名').fieldKey).toBe('basics.fullName');
  });

  it('runs through the phone steps on its own and stops at the one that sends', async () => {
    const page = mokaMobileSteps(steps);
    document.body.innerHTML = page.html;
    let sent = 0;
    page.wire(document, () => sent++);
    const handlers = createStepHandlers(document, {
      adapterStep: () => resolveAdapter(document, ADAPTERS, OWN_DOMAIN)?.stepSignature?.(document) ?? null,
      adapterNext: () => resolveAdapter(document, ADAPTERS, OWN_DOMAIN)?.nextButton,
      isTrusted: () => false,
    });
    const filled: string[] = [];
    let clock = 0;
    const deps: AdvanceDeps = {
      readStep: async () => ({ ...handlers.stepState(), url: OWN_DOMAIN }),
      pressNext: async () => handlers.pressNext(),
      fill: async () => {
        filled.push(document.querySelector('.mobile-layout__content > div[style*="block"] [class*="count-"]')!.textContent!);
        return { ok: true };
      },
      sessionOrigin: async () => new URL(OWN_DOMAIN).origin,
      publish: async () => undefined,
      now: () => clock,
      sleep: async (ms) => {
        clock += ms;
        await new Promise((r) => setTimeout(r, Math.min(ms, 40)));
      },
      pollMs: 50,
      waitMs: 2_000,
      settleMs: 10,
      maxSteps: 10,
    };
    const end = await runAutoAdvance(1, deps);
    handlers.stop();
    expect(end).toMatchObject({ running: false, steps: 2, stopReason: 'final_step' });
    expect(filled).toEqual(['Step: 2/3', 'Step: 3/3']);
    expect(sent).toBe(0);
  });
});

describe('Beisen', () => {
  it('is found on its host for every company', () => {
    expect(idAt('https://acme.zhiye.com/campus/jobs')).toBe('beisen');
    expect(idAt('https://acme.zhiye.com/form?fromPage=editMyResume')).toBe('beisen');
    expect(idAt('https://zhiye.com.evil.test/form')).toBeNull();
  });

  it('is found on a company domain by its form', () => {
    expect(idAt(OWN_DOMAIN, BEISEN_FORM)).toBe('beisen');
  });
});

describe('Feishu', () => {
  it('is found on its host for every company, desktop and phone', () => {
    expect(idAt('https://acme.jobs.feishu.cn/index/position/7000000000000000001/detail')).toBe('feishu');
    expect(idAt('https://acme.jobs.feishu.cn/index/m/position/7000000000000000001/apply')).toBe('feishu');
    expect(idAt('https://jobs.feishu.cn.evil.test/index')).toBeNull();
  });

  it('is found on a company domain by its form, desktop and phone', () => {
    expect(idAt(OWN_DOMAIN, FEISHU_FORM)).toBe('feishu');
    expect(idAt(OWN_DOMAIN, FEISHU_MOBILE_FORM)).toBe('feishu');
  });

  it('on a computer, reads a field by its name and not the advice under it, each in its own section', () => {
    document.body.innerHTML = FEISHU_DESKTOP_ENTRIES;
    const scan = scanDocument(document);
    const at = (id: string) => {
      const i = scan.contexts.findIndex((c) => c.control.el.closest('.atsx-form-item[data-cy]')?.getAttribute('data-cy') === id);
      return { ...scan.classifications[i]!, label: scan.contexts[i]!.evidence[0]?.text, sectionTitle: scan.contexts[i]!.sectionTitle };
    };
    // 起止时间, then 无准确的毕业时间可填写预计毕业时间 under it: the question is the first.
    expect(at('education[0].period').label).toBe('起止时间');
    expect(at('education[0].period').fieldKey).toBe('education.period');
    expect(at('career[0].period').sectionTitle).toBe('工作经历');
    expect(at('career[0].period').fieldKey).toBe('work.period');
    expect(at('career[0].desc').fieldKey).toBe('work.description');
    expect(at('career[0].period').confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it('leaves ByteDance its own address', () => {
    expect(idAt('https://jobs.bytedance.com/campus/position/1')).toBe('bytedance');
  });
});
