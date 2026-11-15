// Which pasted texts can only be filled inside WeChat.
import { describe, expect, it } from 'vitest';
import { wechatOnlyReason } from '../../../../mobile/app/src/keyboard/wechatHint';

describe('wechatOnlyReason', () => {
  it('spots a mini program link anywhere in the text', () => {
    expect(wechatOnlyReason('#小程序://示例招聘/abc123')).toBe('mini-program');
    expect(wechatOnlyReason('快来投递 #小程序://示例招聘/abc123 截止周五')).toBe('mini-program');
    expect(wechatOnlyReason('weixin://dl/business/?t=abc')).toBe('mini-program');
    expect(wechatOnlyReason('打开 weixin://app/wx123/ 看看')).toBe('mini-program');
  });

  it('spots any other weixin:// or wechat:// link as a WeChat scheme', () => {
    expect(wechatOnlyReason('weixin://scanqrcode')).toBe('wechat-scheme');
    expect(wechatOnlyReason('wechat://foo')).toBe('wechat-scheme');
    expect(wechatOnlyReason('WEIXIN://scanqrcode')).toBe('wechat-scheme');
  });

  it('spots the WeChat sign-in pages', () => {
    expect(wechatOnlyReason('https://open.weixin.qq.com/connect/oauth2/authorize?appid=x&redirect_uri=https%3A%2F%2Fexample.com')).toBe('wechat-login');
    expect(wechatOnlyReason('请登录 https://open.weixin.qq.com/connect/qrconnect?appid=x')).toBe('wechat-login');
    expect(wechatOnlyReason('http://open.weixin.qq.com/connect/oauth2/authorize')).toBe('wechat-login');
  });

  it('leaves articles, other WeChat pages and ordinary links alone', () => {
    expect(wechatOnlyReason('https://mp.weixin.qq.com/s/abcdef')).toBeNull();
    expect(wechatOnlyReason('https://weixin.qq.com/')).toBeNull();
    expect(wechatOnlyReason('https://open.weixin.qq.com/cgi-bin/index')).toBeNull();
    expect(wechatOnlyReason('https://example.com')).toBeNull();
    expect(wechatOnlyReason('https://example.com/?next=open.weixin.qq.com/connect/oauth2/')).toBeNull();
    expect(wechatOnlyReason('')).toBeNull();
  });

  it('cuts a long text to 4096 characters before looking', () => {
    const pad = 'x'.repeat(10 * 1024);
    expect(wechatOnlyReason(`${pad} #小程序://示例招聘/abc`)).toBeNull();
    expect(wechatOnlyReason(`#小程序://示例招聘/abc ${pad}`)).toBe('mini-program');
  });
});
