// Where an incoming link goes and when it may run.
import { describe, expect, it } from 'vitest';
import { routeIncoming, waitingMessage, whenToRun, type IncomingRoute } from '../../../../mobile/app/src/incoming/route';
import { DEMO_URL } from '../../../../mobile/app/src/browser/model/constants';

const ctx = { recordIds: new Set(['rec-1']) };

describe('routeIncoming', () => {
  it('view https opens; view http opens marked insecure', () => {
    expect(routeIncoming({ kind: 'view', url: 'https://jobs.example.com/campus' }, ctx)).toEqual({
      do: 'open',
      source: 'view',
      link: { url: 'https://jobs.example.com/campus', host: 'jobs.example.com', insecure: false },
    });
    const http = routeIncoming({ kind: 'view', url: 'http://127.0.0.1:4180/job.html' }, ctx);
    expect(http).toMatchObject({ do: 'open', link: { host: '127.0.0.1', insecure: true } });
  });

  it('view of the demo origin opens the demo', () => {
    expect(routeIncoming({ kind: 'view', url: DEMO_URL }, ctx)).toEqual({ do: 'demo' });
  });

  it('view javascript:, file:, content: say unsupported', () => {
    for (const url of ['javascript:alert(1)', "javascript:fetch('https://evil.example.com')", 'file:///sdcard/a.html', 'content://x/y', 'intent://scan#Intent;end']) {
      expect([url, routeIncoming({ kind: 'view', url }, ctx)]).toEqual([url, { do: 'say', key: 'm.paste.err.unsupported_scheme' }]);
    }
  });

  it('a broken https:// says invalid', () => {
    expect(routeIncoming({ kind: 'view', url: 'https://' }, ctx)).toEqual({ do: 'say', key: 'm.paste.err.invalid' });
    expect(routeIncoming({ kind: 'view', url: 'https://localhost/x' }, ctx)).toEqual({ do: 'say', key: 'm.paste.err.invalid' });
  });

  it('text with no link says so; with a cut text says too long', () => {
    expect(routeIncoming({ kind: 'text', text: '明天下午面试', cut: false }, ctx)).toEqual({ do: 'say', key: 'm.in.noLink' });
    expect(routeIncoming({ kind: 'text', text: '很长的文字', cut: true }, ctx)).toEqual({ do: 'say', key: 'm.in.tooLong' });
    // A cut text with a link in the kept part still opens it.
    expect(routeIncoming({ kind: 'text', text: '入口 https://jobs.example.com', cut: true }, ctx)).toMatchObject({ do: 'open' });
  });

  it("one link opens with the text's title, else the subject", () => {
    expect(routeIncoming({ kind: 'text', text: '【示例科技校园招聘】网申入口 https://jobs.example.com/campus', subject: '别的', cut: false }, ctx)).toEqual({
      do: 'open',
      source: 'share',
      link: { url: 'https://jobs.example.com/campus', host: 'jobs.example.com', title: '示例科技校园招聘 网申入口', insecure: false },
    });
    expect(routeIncoming({ kind: 'text', text: 'https://jobs.example.com/campus', subject: '【示例银行招聘】', cut: false }, ctx)).toMatchObject({
      do: 'open',
      link: { title: '示例银行招聘' },
    });
    const bare = routeIncoming({ kind: 'text', text: 'https://jobs.example.com/campus', cut: false }, ctx) as Extract<IncomingRoute, { do: 'open' }>;
    expect(bare.link.title).toBeUndefined();
  });

  it('many links ask, first 10 and the rest counted', () => {
    const two = routeIncoming({ kind: 'text', text: 'https://a.example.com https://b.example.com', cut: false }, ctx);
    expect(two).toMatchObject({ do: 'choose', more: 0 });
    expect((two as Extract<IncomingRoute, { do: 'choose' }>).links.map((l) => l.host)).toEqual(['a.example.com', 'b.example.com']);
    const text = Array.from({ length: 13 }, (_, i) => `https://jobs.example.com/${i}`).join('\n');
    const many = routeIncoming({ kind: 'text', text, cut: false }, ctx) as Extract<IncomingRoute, { do: 'choose' }>;
    expect(many.links).toHaveLength(10);
    expect(many.more).toBe(3);
    expect(many.links[0]).not.toHaveProperty('ok');
  });

  it('application: known opens, unknown is missing', () => {
    expect(routeIncoming({ kind: 'application', recordId: 'rec-1', open: 'page' }, ctx)).toEqual({ do: 'application', recordId: 'rec-1', open: 'page' });
    expect(routeIncoming({ kind: 'application', recordId: 'rec-1', open: 'detail' }, ctx)).toEqual({ do: 'application', recordId: 'rec-1', open: 'detail' });
    expect(routeIncoming({ kind: 'application', recordId: 'gone', open: 'page' }, ctx)).toEqual({ do: 'missing' });
    expect(routeIncoming({ kind: 'application', recordId: 'rec-1', open: 'page', from: 'reminder' }, ctx)).toEqual({
      do: 'application',
      recordId: 'rec-1',
      open: 'page',
      from: 'reminder',
    });
  });

  it('paste, demo and refused', () => {
    expect(routeIncoming({ kind: 'paste' }, ctx)).toEqual({ do: 'paste' });
    expect(routeIncoming({ kind: 'demo' }, ctx)).toEqual({ do: 'demo' });
    expect(routeIncoming({ kind: 'refused', reason: 'scheme' }, ctx)).toEqual({ do: 'say', key: 'm.paste.err.unsupported_scheme' });
    expect(routeIncoming({ kind: 'refused', reason: 'too_long' }, ctx)).toEqual({ do: 'say', key: 'm.paste.err.too_long' });
  });
});

describe('whenToRun', () => {
  const link = { url: 'https://jobs.example.com/', host: 'jobs.example.com', insecure: false };
  const routes: Record<string, IncomingRoute> = {
    open: { do: 'open', link, source: 'view' },
    demo: { do: 'demo' },
    page: { do: 'application', recordId: 'rec-1', open: 'page' },
    choose: { do: 'choose', links: [link, link], more: 0 },
    paste: { do: 'paste' },
    detail: { do: 'application', recordId: 'rec-1', open: 'detail' },
    say: { do: 'say', key: 'm.in.noLink' },
    missing: { do: 'missing' },
  };
  const idle = { ready: true, importOpen: false, runActive: false, onboarding: false };
  const row = (busy: Partial<typeof idle>) =>
    Object.fromEntries(Object.entries(routes).map(([name, r]) => [name, whenToRun(r, { ...idle, ...busy })]));

  it('whenToRun follows the table of 3.5', () => {
    expect(row({ ready: false })).toEqual({ open: 'wait', demo: 'wait', page: 'wait', choose: 'wait', paste: 'wait', detail: 'wait', say: 'wait', missing: 'wait' });
    expect(row({ importOpen: true })).toEqual({ open: 'wait', demo: 'wait', page: 'wait', choose: 'wait', paste: 'wait', detail: 'wait', say: 'now', missing: 'now' });
    expect(row({ runActive: true })).toEqual({ open: 'wait', demo: 'wait', page: 'wait', choose: 'wait', paste: 'now', detail: 'now', say: 'now', missing: 'now' });
    expect(row({})).toEqual({ open: 'now', demo: 'now', page: 'now', choose: 'now', paste: 'now', detail: 'now', say: 'now', missing: 'now' });
    expect(row({ onboarding: true })).toEqual({ open: 'now', demo: 'now', page: 'now', choose: 'now', paste: 'drop', detail: 'drop', say: 'now', missing: 'now' });
  });

  it('the waiting toast is said for page opens only, once per blocking state', () => {
    expect(waitingMessage(routes.open!, { ...idle, importOpen: true })).toBe('m.in.waiting');
    expect(waitingMessage(routes.page!, { ...idle, importOpen: true })).toBe('m.in.waiting');
    expect(waitingMessage(routes.choose!, { ...idle, importOpen: true })).toBeNull();
    expect(waitingMessage(routes.demo!, { ...idle, runActive: true })).toBe('m.in.waitingFill');
    expect(waitingMessage(routes.paste!, { ...idle, importOpen: true })).toBeNull();
    expect(waitingMessage(routes.open!, { ...idle, ready: false })).toBeNull();
    expect(waitingMessage(routes.open!, idle)).toBeNull();
  });
});
