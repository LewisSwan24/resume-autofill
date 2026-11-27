// What is checked before a recording and said after it. The checks after it never stop a sample being written: they
// say why a recording holds no form, so that a captcha page is not kept as one by mistake.
import { describe, expect, it } from 'vitest';
import { CHECKLIST, looksChinese, pageWarnings } from '../../../src/capture/checklist';

const page = (body: string) => ({ file: 'page.html', html: `<!doctype html><html><body>${body}</body></html>` });
const FORM = '<form><label>Email <input type="email" name="email"></label></form>';

describe('the checklist before recording', () => {
  it('names the five things only the applicant can see to', () => {
    expect(CHECKLIST.map((c) => c.id)).toEqual(['fictional', 'country', 'consent', 'not-applied', 'signed-in']);
    for (const item of CHECKLIST) expect(item.text.length).toBeGreaterThan(8);
  });

  it('takes a page for Chinese by its address or its language', () => {
    expect(looksChinese('https://campus.example.cn/apply', '')).toBe(true);
    expect(looksChinese('https://jobs.example.com.cn/apply', 'en')).toBe(true);
    expect(looksChinese('https://app.mokahr.com/apply', 'zh-CN')).toBe(true);
    expect(looksChinese('https://jobs.example.com/apply', 'en-AU')).toBe(false);
    expect(looksChinese('https://jobs.example.com/cn/apply', '')).toBe(false);
  });
});

describe('what a recording is said to be instead of a form', () => {
  it('says nothing of a page with a form', () => {
    expect(pageWarnings([page(FORM)])).toEqual([]);
    expect(pageWarnings([page('<div role="combobox" aria-label="City"></div>')])).toEqual([]);
  });

  it('says when no frame has a box to fill', () => {
    expect(pageWarnings([page('<p>Thanks</p><input type="hidden" name="t">'), { file: 'frame-1.html', html: '<p>ad</p>' }])).toEqual(['no-form']);
  });

  it('says nothing of a captcha or an already-applied note on a page that has its form', () => {
    // An invisible reCAPTCHA at the foot of the form, and Recruitee's hidden note for a second visit.
    const extras = `<div class="g-recaptcha"></div><p style="display:none">You've already applied for this job</p>`;
    expect(pageWarnings([page(FORM + extras), { file: 'frame-1.html', html: "<p>I'm not a robot</p>" }])).toEqual([]);
  });

  it('says why there is no form when a frame is a captcha or a slider', () => {
    for (const body of [
      '<div class="geetest_panel"></div>',
      '<div class="g-recaptcha"></div>',
      '<p>请完成安全验证</p>',
      '<span>向右拖动滑块</span>',
      "<p>Verify you are human</p>",
    ]) {
      expect(pageWarnings([page(body)]), body).toEqual(['no-form', 'captcha']);
    }
  });

  it('says why there is no form when the page says the job was applied for already', () => {
    for (const body of ['<p>您已投递过该职位</p>', '<p>你已申请过此职位</p>', "<p>You've already applied for this job.</p>", '<p>You have already applied to this position</p>']) {
      expect(pageWarnings([page(body)]), body).toEqual(['no-form', 'applied']);
    }
  });

  it('is not set off by a menu of past applications or a word in a field name', () => {
    expect(pageWarnings([page(`${FORM}<nav><a>已申请职位</a><a>My applications</a></nav><input name="captchaRequired">`)])).toEqual([]);
  });
});
