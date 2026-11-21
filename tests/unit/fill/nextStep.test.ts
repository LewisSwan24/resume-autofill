import { beforeEach, describe, expect, it } from 'vitest';
import { classifyStepButton, findStepAction, pageBlocker, stepFingerprint, stepTitle } from '../../../src/fill/nextStep';

const page = (html: string): Document => {
  document.body.innerHTML = html;
  return document;
};

describe('classifyStepButton', () => {
  it.each(['下一步', '下一步 >', '继续', '保存并继续', '保存并下一步', 'Next', 'Next →', 'Next step', 'Continue', 'Save and Continue', 'Save & Continue', 'Proceed'])(
    '%s moves to the next step',
    (text) => expect(classifyStepButton(text)).toBe('next'),
  );

  it.each(['提交', '提交申请', '确认投递', '投递简历', '立即申请', '完成', '确认', 'Submit', 'Submit application', 'Apply', 'Apply now', 'Send', 'Finish', 'Done', 'Review and submit'])(
    '%s sends the application',
    (text) => expect(classifyStepButton(text)).toBe('submit'),
  );

  it.each(['保存并提交', 'Continue and submit', 'Next: submit', '继续投递'])('%s says both, so it counts as sending', (text) =>
    expect(classifyStepButton(text)).toBe('submit'),
  );

  it.each(['上一步', 'Back', 'Previous', '下一页', 'Add another', '添加', 'Save draft', '保存草稿', ''])('%s is neither', (text) =>
    expect(classifyStepButton(text)).toBe('other'),
  );
});

describe('findStepAction', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('picks the Next button next to Back', () => {
    const doc = page('<form><input name="a"><button type="button">Back</button><button id="next">Next</button></form>');
    const action = findStepAction(doc);
    expect(action.kind).toBe('next');
    expect(action.kind === 'next' && action.button.id).toBe('next');
  });

  it('reads input[type=submit] values and role=button elements', () => {
    expect(findStepAction(page('<input type="submit" value="保存并继续">')).kind).toBe('next');
    expect(findStepAction(page('<div role="button" tabindex="0">下一步</div>')).kind).toBe('next');
  });

  it('calls a page with only a send button the final step', () => {
    expect(findStepAction(page('<button>上一步</button><button>提交申请</button>')).kind).toBe('final');
  });

  it('never offers a Next button when a send button is the only visible one', () => {
    const doc = page('<button style="display:none">Next</button><button>Submit</button>');
    expect(findStepAction(doc).kind).toBe('final');
  });

  it('says none when the page has neither', () => {
    expect(findStepAction(page('<input name="a"><button>Back</button>')).kind).toBe('none');
  });

  it('stops on two different next buttons', () => {
    expect(findStepAction(page('<button>Next</button><button>Continue</button>')).kind).toBe('ambiguous');
  });

  it('stops when a Next button and a send button are both showing', () => {
    expect(findStepAction(page('<button>Next</button><button>Submit</button>')).kind).toBe('ambiguous');
  });

  it('takes the last of two identical Next buttons (header and footer copies)', () => {
    const doc = page('<button id="top">下一步</button><input><button id="bottom">下一步</button>');
    const action = findStepAction(doc);
    expect(action.kind === 'next' && action.button.id).toBe('bottom');
  });

  it('reports a disabled Next button as waiting for the user', () => {
    expect(findStepAction(page('<button disabled>Next</button>')).kind).toBe('disabled');
    expect(findStepAction(page('<button aria-disabled="true">Next</button>')).kind).toBe('disabled');
  });

  it('lets the site adapter name the button, but still never presses one that sends', () => {
    const next = page('<button>Next</button><button data-automation-id="pageFooterNextButton">Save and Continue</button>');
    const a = findStepAction(next, '[data-automation-id="pageFooterNextButton"]');
    expect(a.kind === 'next' && a.button.textContent).toBe('Save and Continue');

    const last = page('<button data-automation-id="pageFooterNextButton">Submit</button>');
    expect(findStepAction(last, '[data-automation-id="pageFooterNextButton"]').kind).toBe('final');
  });
});

describe('pageBlocker', () => {
  it('is clear when every required control has a value', () => {
    const doc = page('<input required value="x"><select required><option value="a" selected>a</option></select><textarea required>t</textarea>');
    expect(pageBlocker(doc)).toBeNull();
  });

  it('stops on an empty required control', () => {
    expect(pageBlocker(page('<input required>'))).toBe('needs_you');
    expect(pageBlocker(page('<textarea aria-required="true"></textarea>'))).toBe('needs_you');
    expect(pageBlocker(page('<select required><option value="">Select</option></select>'))).toBe('needs_you');
  });

  it('stops on a required radio group with nothing chosen, and a required box left unticked', () => {
    expect(pageBlocker(page('<input type="radio" name="r" required><input type="radio" name="r">'))).toBe('needs_you');
    expect(pageBlocker(page('<input type="radio" name="r" required><input type="radio" name="r" checked>'))).toBeNull();
    expect(pageBlocker(page('<label><input type="checkbox" required> I agree</label>'))).toBe('needs_you');
  });

  it('ignores required controls the page has switched off', () => {
    expect(pageBlocker(page('<input required disabled>'))).toBeNull();
  });

  it('ignores hidden required controls', () => {
    expect(pageBlocker(page('<div style="display:none"><input required></div><input type="hidden" required>'))).toBeNull();
  });

  it('takes a dropdown still on its placeholder as unanswered (Breezy, Angular)', () => {
    // Angular puts an unnamed "? undefined:undefined ?" option first while nothing is chosen.
    const angular = '<option value="? undefined:undefined ?"></option><option value="Yes">Yes</option><option value="No">No</option>';
    expect(pageBlocker(page(`<select required>${angular}</select>`))).toBe('needs_you');
    expect(pageBlocker(page('<select required><option value="-1">Please select</option><option value="1">Yes</option></select>'))).toBe('needs_you');
    expect(pageBlocker(page('<select required><option value="0">请选择</option><option value="1">是</option></select>'))).toBe('needs_you');
    const chosen = page(`<select required>${angular}</select>`);
    chosen.querySelector('select')!.value = 'No';
    expect(pageBlocker(chosen)).toBeNull();
  });

  it("stops on a 'response is required' message the page is showing", () => {
    const question = (shown: boolean, text: string) => `<li><h3>Are you over 18 years?</h3><select><option value="Yes" selected>Yes</option></select>
      <div class="error-container${shown ? '' : '" style="display:none'}"><span class="error">${text}</span></div></li>`;
    expect(pageBlocker(page(question(false, 'A response is required')))).toBeNull();
    expect(pageBlocker(page(question(true, 'A response is required')))).toBe('needs_you');
    expect(pageBlocker(page(question(true, '回复是必填项')))).toBe('needs_you');
    expect(pageBlocker(page('<p role="alert">This field is required.</p>'))).toBe('needs_you');
  });

  it('does not take a required marker or a note about required fields as an error', () => {
    expect(pageBlocker(page('<p class="form-note">Fields marked * are required</p><span class="required">*</span>'))).toBeNull();
    expect(pageBlocker(page('<p class="hint">带 * 的为必填项</p>'))).toBeNull();
    expect(pageBlocker(page('<div class="error">Something went wrong loading the map.</div>'))).toBeNull();
  });

  it('stops on a control the page marked invalid', () => {
    expect(pageBlocker(page('<input value="abc" aria-invalid="true">'))).toBe('needs_you');
  });

  it('stops on a captcha or a texted code', () => {
    expect(pageBlocker(page('<iframe src="https://www.google.com/recaptcha/api2/anchor"></iframe>'))).toBe('verification');
    expect(pageBlocker(page('<div class="geetest_holder"></div>'))).toBe('verification');
    expect(pageBlocker(page('<input placeholder="请输入短信验证码">'))).toBe('verification');
    expect(pageBlocker(page('<label for="c">Verification code</label><input id="c">'))).toBe('verification');
  });
});

describe('stepFingerprint', () => {
  it('uses the adapter step name when there is one', () => {
    expect(stepFingerprint(page('<input name="a">'), 'My Experience')).toBe('step:My Experience');
  });

  it('otherwise changes when a different set of fields is showing', () => {
    const first = stepFingerprint(page('<input name="first"><input name="last">'), null);
    expect(stepFingerprint(page('<input name="first"><input name="last">'), null)).toBe(first);
    const second = stepFingerprint(page('<div style="display:none"><input name="first"></div><input name="school">'), null);
    expect(second).not.toBe(first);
  });

  it('does not change while the user types', () => {
    const doc = page('<input name="first">');
    const before = stepFingerprint(doc, null);
    (doc.querySelector('input') as HTMLInputElement).value = 'typed';
    expect(stepFingerprint(doc, null)).toBe(before);
  });
});

describe('stepTitle', () => {
  it('reads the step the page marks as current', () => {
    expect(stepTitle(page('<ol><li>基本信息</li><li aria-current="step"><span>2</span> 教育经历</li><li>其他</li></ol>'))).toBe('教育经历');
  });

  it('reads the common step bars of Chinese portals', () => {
    expect(
      stepTitle(page('<div class="ant-steps"><div class="ant-steps-item ant-steps-item-finish"><div class="ant-steps-item-title">基本信息</div></div><div class="ant-steps-item ant-steps-item-process"><div class="ant-steps-item-title">实习经历</div></div></div>')),
    ).toBe('实习经历');
    expect(stepTitle(page('<div class="el-steps"><div class="el-step is-finish"><div class="el-step__title">一</div></div><div class="el-step is-process"><div class="el-step__title">03 其他信息</div></div></div>'))).toBe('其他信息');
  });

  it('is null with no step bar, or a "current" text too long to be a step name', () => {
    expect(stepTitle(page('<form><h2>基本信息</h2><input></form>'))).toBeNull();
    expect(stepTitle(page(`<div aria-current="step">${'很长的说明'.repeat(10)}</div>`))).toBeNull();
  });
});
