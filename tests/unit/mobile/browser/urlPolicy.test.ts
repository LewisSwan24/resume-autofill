import { describe, expect, it } from 'vitest';
import { classifyOpen, decideExternal } from '../../../../mobile/app/src/browser/model/urlPolicy';
import { DEMO_URL } from '../../../../mobile/app/src/browser/model/constants';

const go = (url: string, gesture = true) => decideExternal({ url, gesture });

describe('decideExternal', () => {
  it('rule 1: no gesture → ignore, even for tel: and weixin:', () => {
    expect(go('tel:10086', false)).toEqual({ action: 'ignore' });
    expect(go('weixin://dl/business/?t=x', false)).toEqual({ action: 'ignore' });
  });

  it('rule 2: tel: asks to call with a cleaned number', () => {
    expect(go('tel:10086')).toEqual({ action: 'ask', kind: 'call', target: '10086', url: 'tel:10086' });
    expect(go('tel:%2B86%20138-0000-0000')).toMatchObject({ kind: 'call', target: '+86 138-0000-0000' });
    expect(go('tel:<script>')).toEqual({ action: 'blocked' });
    expect((go(`tel:${'1'.repeat(50)}`) as { target: string }).target).toHaveLength(32);
  });

  it('rule 3: mailto: target is the address before ?; sms: and smsto: ask like tel', () => {
    expect(go('mailto:hr@example.com?subject=x')).toEqual({ action: 'ask', kind: 'mail', target: 'hr@example.com', url: 'mailto:hr@example.com?subject=x' });
    expect(go('sms:10086')).toMatchObject({ action: 'ask', kind: 'sms', target: '10086' });
    expect(go('smsto:10086?body=hi')).toMatchObject({ action: 'ask', kind: 'sms', target: '10086' });
    expect(go('mailto:')).toEqual({ action: 'blocked' });
  });

  it('rule 4: intent: with an http(s) fallback → fallback; a javascript: fallback is refused', () => {
    expect(go('intent://x#Intent;scheme=weixin;S.browser_fallback_url=https%3A%2F%2Fm.example.com%2F;end')).toEqual({
      action: 'fallback',
      url: 'https://m.example.com/',
      host: 'm.example.com',
    });
    expect(go('intent://x#Intent;scheme=weixin;S.browser_fallback_url=javascript%3Aalert(1);end')).toEqual({
      action: 'app',
      app: 'weixin',
      url: 'intent://x#Intent;scheme=weixin;S.browser_fallback_url=javascript%3Aalert(1);end',
    });
    expect(go('intent://x#Intent;scheme=unknownapp;end')).toMatchObject({ action: 'app', app: null });
  });

  it.each([
    ['weixin://dl/business/?t=x', 'weixin'],
    ['wechat://x', 'weixin'],
    ['alipays://platformapi', 'alipay'],
    ['alipay://x', 'alipay'],
    ['mqq://x', 'qq'],
    ['mqqapi://x', 'qq'],
    ['mqqwpa://x', 'qq'],
    ['dingtalk://x', 'dingtalk'],
    ['lark://x', 'lark'],
    ['feishu://x', 'lark'],
    ['taobao://x', 'taobao'],
    ['tbopen://x', 'taobao'],
    ['snssdk1128://x', 'douyin'],
    ['snssdk1233://x', 'douyin'],
    ['aweme://x', 'douyin'],
  ])('rule 5: %s → app %s', (url, app) => {
    expect(go(url)).toEqual({ action: 'app', app, url });
  });

  it.each(['javascript:alert(1)', 'file:///sdcard/x', 'content://x/y', 'data:text/html,hi', 'blob:https://a/b', 'market://details?id=x', 'itms-apps://x', 'itms-services://x', 'whatever:1'])(
    'rule 6: %s → blocked',
    (url) => {
      expect(go(url)).toEqual({ action: 'blocked' });
    },
  );
});

describe('classifyOpen', () => {
  it('opens only http(s) and the demo', () => {
    expect(classifyOpen('https://jobs.example.com/a')).toBe('web');
    expect(classifyOpen('http://jobs.example.com/a')).toBe('web');
    expect(classifyOpen(DEMO_URL)).toBe('demo');
    expect(classifyOpen('javascript:alert(1)')).toBeNull();
    expect(classifyOpen('file:///x')).toBeNull();
  });
});

describe('decideExternal from a frame inside the page', () => {
  const sub = (url: string) => decideExternal({ url, gesture: true, main: false });

  it('keeps asking for tel:, sms: and mailto:, as the main page does', () => {
    expect(sub('tel:10086')).toEqual({ action: 'ask', kind: 'call', target: '10086', url: 'tel:10086' });
    expect(sub('sms:10086')).toMatchObject({ action: 'ask', kind: 'sms' });
    expect(sub('mailto:hr@example.com')).toMatchObject({ action: 'ask', kind: 'mail' });
  });

  it('refuses an intent: fallback, which would replace the whole page', () => {
    expect(sub('intent://x#Intent;scheme=weixin;S.browser_fallback_url=https%3A%2F%2Fm.example.com%2F;end')).toEqual({ action: 'blocked' });
  });

  it('refuses launching another app, by app scheme or by intent:', () => {
    expect(sub('weixin://dl/business/?t=x')).toEqual({ action: 'blocked' });
    expect(sub('intent://x#Intent;scheme=unknownapp;end')).toEqual({ action: 'blocked' });
  });

  it('still ignores a frame link without a gesture', () => {
    expect(decideExternal({ url: 'tel:10086', gesture: false, main: false })).toEqual({ action: 'ignore' });
  });

  it('leaves the main page as it was when main is true', () => {
    expect(decideExternal({ url: 'weixin://dl/business/?t=x', gesture: true, main: true })).toMatchObject({ action: 'app', app: 'weixin' });
  });
});
