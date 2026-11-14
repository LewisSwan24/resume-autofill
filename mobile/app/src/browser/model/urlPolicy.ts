// What the fill browser does with a URL: which links it opens, and what happens when a page tries to leave
// http(s) (tel:, app schemes, intent:...). Pure. Native has already cancelled the navigation; this only decides
// whether to ask the person, offer a copy, load a web fallback, or drop it.
import { DEMO_URL } from './constants';

export type AppName = 'weixin' | 'alipay' | 'qq' | 'dingtalk' | 'lark' | 'taobao' | 'douyin';

export type ExternalDecision =
  /** No gesture, or a silent drop. */
  | { action: 'ignore' }
  | { action: 'ask'; kind: 'call' | 'mail' | 'sms'; target: string; url: string }
  /** Copy link only; never launched. */
  | { action: 'app'; app: AppName | null; url: string }
  /** Load the web version here. */
  | { action: 'fallback'; url: string; host: string }
  /** Toast. */
  | { action: 'blocked' };

const APP_SCHEMES: Readonly<Record<string, AppName>> = {
  weixin: 'weixin',
  wechat: 'weixin',
  alipays: 'alipay',
  alipay: 'alipay',
  mqq: 'qq',
  mqqapi: 'qq',
  mqqwpa: 'qq',
  dingtalk: 'dingtalk',
  lark: 'lark',
  feishu: 'lark',
  taobao: 'taobao',
  tbopen: 'taobao',
  snssdk1128: 'douyin',
  snssdk1233: 'douyin',
  aweme: 'douyin',
};

/** Which links the browser opens at all: http(s) pages and the built-in demo. */
export function classifyOpen(url: string): 'web' | 'demo' | null {
  if (url === DEMO_URL) return 'demo';
  try {
    const { protocol } = new URL(url);
    return protocol === 'http:' || protocol === 'https:' ? 'web' : null;
  } catch {
    return null;
  }
}

const decode = (s: string): string => {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
};

const schemeOf = (url: string): string => {
  const m = /^([a-z][a-z0-9+.-]*):/i.exec(url.trim());
  return m ? m[1]!.toLowerCase() : '';
};

/** Body of tel:/sms: — the number only, at most 32 characters of digits and dial symbols. */
function phoneTarget(rest: string): string {
  const beforeQuery = rest.split('?')[0] ?? '';
  return decode(beforeQuery).replace(/[^0-9+*#,; -]/g, '').trim().slice(0, 32);
}

function httpUrl(text: string): URL | null {
  try {
    const u = new URL(text);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u : null;
  } catch {
    return null;
  }
}

function decideIntent(url: string): ExternalDecision {
  const start = url.indexOf('#Intent;');
  let scheme = '';
  if (start >= 0) {
    const body = url.slice(start + '#Intent;'.length);
    const end = body.lastIndexOf(';end');
    for (const part of (end >= 0 ? body.slice(0, end) : body).split(';')) {
      const eq = part.indexOf('=');
      if (eq < 0) continue;
      const key = part.slice(0, eq);
      const value = part.slice(eq + 1);
      if (key === 'scheme') scheme = value.toLowerCase();
      if (key === 'S.browser_fallback_url') {
        const fallback = httpUrl(decode(value));
        if (fallback) return { action: 'fallback', url: fallback.href, host: fallback.host };
      }
    }
  }
  return { action: 'app', app: APP_SCHEMES[scheme] ?? null, url };
}

/**
 * `main` false means the link was tapped inside a frame of the page (often another site's). Such a frame may still
 * offer a call, a message or a mail, which the person confirms on a sheet, but never launches another app or replaces
 * the whole page through an intent: fallback.
 */
export function decideExternal(e: { url: string; gesture: boolean; main?: boolean }): ExternalDecision {
  const decision = decideExternalFromPage(e);
  if (e.main === false && (decision.action === 'app' || decision.action === 'fallback')) return { action: 'blocked' };
  return decision;
}

function decideExternalFromPage(e: { url: string; gesture: boolean }): ExternalDecision {
  if (!e.gesture) return { action: 'ignore' };
  const url = e.url;
  const scheme = schemeOf(url);
  const rest = url.trim().slice(scheme.length + 1);

  if (scheme === 'tel' || scheme === 'sms' || scheme === 'smsto') {
    const target = phoneTarget(rest);
    if (!target) return { action: 'blocked' };
    return { action: 'ask', kind: scheme === 'tel' ? 'call' : 'sms', target, url };
  }
  if (scheme === 'mailto') {
    const target = decode(rest.split('?')[0] ?? '').trim().slice(0, 254);
    if (!target) return { action: 'blocked' };
    return { action: 'ask', kind: 'mail', target, url };
  }
  if (scheme === 'intent') return decideIntent(url);
  const app = APP_SCHEMES[scheme];
  if (app) return { action: 'app', app, url };
  return { action: 'blocked' };
}
