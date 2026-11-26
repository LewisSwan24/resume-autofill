// @vitest-environment node
// `pnpm capture --open` presses one button that shows a form on the same page. It must never be one that sends.
import { describe, expect, it } from 'vitest';
import { sendsForm } from '../../../scripts/capture/open';

describe('the button --open may press', () => {
  it.each(['Apply for This Job', 'Apply', 'I am interested', 'Start application', '申请职位', '立即申請'])('presses "%s"', (text) => {
    expect(sendsForm(text)).toBe(false);
  });

  it.each(['Submit', 'Submit Application', 'Send', 'Send application', 'Apply now and submit', '提交', '提交申请', '投递简历', '投遞', '发送', '確認送出'])(
    'refuses "%s"',
    (text) => {
      expect(sendsForm(text)).toBe(true);
    },
  );
});
