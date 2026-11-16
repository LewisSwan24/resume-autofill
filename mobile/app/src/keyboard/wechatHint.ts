// Which pasted texts only WeChat can open, so the app suggests the resume keyboard instead of its own browser
// for them. Pure: it looks at the text once and keeps nothing.

export type WechatOnlyReason = 'mini-program' | 'wechat-scheme' | 'wechat-login';

const MAX_TEXT = 4096;
const MINI_PROGRAM = /#小程序:\/\/|weixin:\/\/(dl\/business\/|app\/)/i;
const WECHAT_SCHEME = /(?:^|[^a-z0-9+.-])(weixin|wechat):\/\//i;
const HTTP_URL = /https?:\/\/[^\s<>"'，。；、）)】]+/gi;

function isWechatLogin(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.hostname.toLowerCase() !== 'open.weixin.qq.com') return false;
  return url.pathname.startsWith('/connect/oauth2/') || url.pathname.startsWith('/connect/qrconnect');
}

export function wechatOnlyReason(text: string): WechatOnlyReason | null {
  const cut = text.slice(0, MAX_TEXT);
  if (MINI_PROGRAM.test(cut)) return 'mini-program';
  if (WECHAT_SCHEME.test(cut)) return 'wechat-scheme';
  for (const match of cut.matchAll(HTTP_URL)) {
    if (isWechatLogin(match[0])) return 'wechat-login';
  }
  return null;
}
