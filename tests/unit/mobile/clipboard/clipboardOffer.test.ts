// When the app may read the clipboard, and which copied links it offers.
import { describe, expect, it } from 'vitest';
import { linkDigest, pickOffer, rememberDismissed, shouldRead } from '../../../../mobile/app/src/clipboard/clipboardOffer';
import type { ClipHint } from '../../../../mobile/app/src/native/clipboardPeek';
import { defaultAppState } from '../../../../mobile/app/src/store/appStateStore';
import { recentKey } from '../../../../mobile/app/src/store/recentPages';

const hint: ClipHint = { focused: true, hasText: true, stamp: 1000, likelyUrl: 'unknown', sensitive: false };
const settings = defaultAppState().clipboard;

async function digestsOf(...urls: string[]): Promise<Map<string, string>> {
  return new Map(await Promise.all(urls.map(async (u) => [recentKey(u), await linkDigest(u)] as [string, string])));
}

describe('shouldRead', () => {
  it('reads a new, plain clip when everything allows it', () => {
    expect(shouldRead(hint, settings, { active: true })).toBe(true);
    expect(shouldRead({ ...hint, likelyUrl: 'yes' }, settings, { active: true })).toBe(true);
  });

  it('shouldRead is false for each failing condition', () => {
    const cases: [string, boolean][] = [
      ['switch off', shouldRead(hint, { ...settings, offer: false }, { active: true })],
      ['not active', shouldRead(hint, settings, { active: false })],
      ['not focused', shouldRead({ ...hint, focused: false }, settings, { active: true })],
      ['no text', shouldRead({ ...hint, hasText: false }, settings, { active: true })],
      ['sensitive', shouldRead({ ...hint, sensitive: true }, settings, { active: true })],
      ['not a url', shouldRead({ ...hint, likelyUrl: 'no' }, settings, { active: true })],
      ['no stamp', shouldRead({ ...hint, stamp: null }, settings, { active: true })],
      ['seen stamp', shouldRead(hint, { ...settings, lastStamp: 1000 }, { active: true })],
    ];
    for (const [name, value] of cases) expect([name, value]).toEqual([name, false]);
  });
});

describe('pickOffer', () => {
  it('a new link is offered', async () => {
    const text = '示例科技校园招聘 https://jobs.example.com/campus';
    const offer = pickOffer(text, 1000, new Set(), new Set(), await digestsOf('https://jobs.example.com/campus'));
    expect(offer).toEqual({
      stamp: 1000,
      links: [{ url: 'https://jobs.example.com/campus', host: 'jobs.example.com', title: '示例科技校园招聘', insecure: false }],
    });
  });

  it('a link that is already a record is not', async () => {
    const url = 'https://jobs.example.com/campus';
    expect(pickOffer(url, 1, new Set([recentKey(url)]), new Set(), await digestsOf(url))).toBeNull();
  });

  it('a dismissed link is not offered again', async () => {
    const url = 'https://jobs.example.com/campus';
    const digests = await digestsOf(url);
    expect(pickOffer(url, 1, new Set(), new Set([digests.get(url)!]), digests)).toBeNull();
    // A link whose digest is unknown is not offered either (nothing to check it against).
    expect(pickOffer(url, 1, new Set(), new Set(), new Map())).toBeNull();
  });

  it('several new links are offered together; known ones left out', async () => {
    const urls = ['https://a.example.com/', 'https://b.example.com/', 'https://c.example.com/'];
    const offer = pickOffer(urls.join(' '), 5, new Set([recentKey(urls[1]!)]), new Set(), await digestsOf(...urls));
    expect(offer?.links.map((l) => l.host)).toEqual(['a.example.com', 'c.example.com']);
    expect(pickOffer('没有链接', 5, new Set(), new Set(), new Map())).toBeNull();
  });

  it('digests ignore the fragment', async () => {
    const a = await linkDigest('https://jobs.example.com/x#top');
    expect(a).toBe(await linkDigest('https://jobs.example.com/x'));
    expect(a).toMatch(/^[0-9a-f]{32}$/);
    expect(a).not.toBe(await linkDigest('https://jobs.example.com/y'));
  });
});

describe('rememberDismissed', () => {
  it('the dismissed list keeps the newest 20', () => {
    const d = (i: number) => i.toString(16).padStart(32, '0');
    let s = settings;
    for (let i = 0; i < 25; i += 1) s = rememberDismissed(s, [d(i)]);
    expect(s.dismissed).toHaveLength(20);
    expect(s.dismissed[0]).toBe(d(24));
    expect(s.dismissed).not.toContain(d(4));
    const again = rememberDismissed(s, [d(10), d(30)]);
    expect(again.dismissed.slice(0, 2)).toEqual([d(10), d(30)]);
    expect(again.dismissed.filter((x) => x === d(10))).toHaveLength(1);
    expect(again.offer).toBe(s.offer);
  });
});
