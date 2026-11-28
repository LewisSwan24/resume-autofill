// @vitest-environment node
// `pnpm capture --open` presses one button that shows a form on the same page. It must never be one that sends.
import { describe, expect, it } from 'vitest';
import { declinesCookies, sendsForm } from '../../../scripts/capture/open';

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

describe('a cookie banner in the way of that button', () => {
  // Only a button inside the banner, and only the answer that keeps the fewest cookies.
  it.each([
    ['Decline non-essential', 'career-cookie-consent'],
    ['Reject all', 'onetrust-banner-sdk'],
    ['Use necessary cookies only', 'cookie-bar'],
    ['Only necessary', 'gdpr-consent'],
    ['拒绝', 'cookie-notice'],
  ])('declines with "%s" in %s', (text, holder) => {
    expect(declinesCookies(text, holder)).toBe(true);
  });

  it.each([
    ['Accept all', 'career-cookie-consent'],
    ['Accept', 'cookie-bar'],
    ['Customise', 'cookie-bar'],
    ['Decline non-essential', 'job-detail'],
    ['Decline', 'offer-panel'],
  ])('leaves "%s" in %s alone', (text, holder) => {
    expect(declinesCookies(text, holder)).toBe(false);
  });
});
