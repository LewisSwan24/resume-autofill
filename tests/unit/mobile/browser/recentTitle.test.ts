import { describe, expect, it } from 'vitest';
import { updateRecentTitle } from '../../../../mobile/app/src/browser/model/recentTitle';
import { AppStateV1Schema, type AppStateV1 as AppState } from '../../../../mobile/app/src/store/appStateMigrate';

// Legacy helper on the v1 shape.
const defaultAppState = (o: Partial<AppState> = {}): AppState => AppStateV1Schema.parse({ version: 1, ...o });

const state = (): AppState =>
  defaultAppState({
    recentPages: [
      { id: 'a', url: 'https://jobs.example.com/apply', host: 'jobs.example.com', addedAt: 100 },
      { id: 'b', url: 'https://www.example.com/', host: 'www.example.com', title: '旧标题', addedAt: 50 },
    ],
  });

describe('updateRecentTitle', () => {
  it('sets the title of the entry without touching addedAt, order or url', () => {
    const s = state();
    const next = updateRecentTitle(s, 'a', '示例公司 网申', 'jobs.example.com');
    expect(next.recentPages[0]).toEqual({ ...s.recentPages[0], title: '示例公司 网申' });
    expect(next.recentPages.map((p) => p.id)).toEqual(['a', 'b']);
    expect(next.recentPages[1]).toBe(s.recentPages[1]);
  });

  it('an unknown id returns the same state object', () => {
    const s = state();
    expect(updateRecentTitle(s, 'zzz', 'x', 'jobs.example.com')).toBe(s);
  });

  it('only for the same site: www., subdomains either way', () => {
    const s = state();
    expect(updateRecentTitle(s, 'b', '新标题', 'example.com').recentPages[1]!.title).toBe('新标题');
    expect(updateRecentTitle(s, 'a', '新标题', 'example.com').recentPages[0]!.title).toBe('新标题');
    expect(updateRecentTitle(s, 'a', '新标题', 'login.jobs.example.com').recentPages[0]!.title).toBe('新标题');
    expect(updateRecentTitle(s, 'a', '别的网站', 'other.example.net')).toBe(s);
    expect(updateRecentTitle(s, 'a', '别的网站', 'notexample.com')).toBe(s);
  });

  it('a port on the shown host does not make it another site (the address bar shows 127.0.0.1:4180)', () => {
    const s = defaultAppState({ recentPages: [{ id: 'p', url: 'http://127.0.0.1:4180/outer.html', host: '127.0.0.1', addedAt: 1 }] });
    expect(updateRecentTitle(s, 'p', '外层示例页', '127.0.0.1:4180').recentPages[0]!.title).toBe('外层示例页');
    expect(updateRecentTitle(s, 'p', '别的网站', '127.0.0.2:4180')).toBe(s);
  });

  it('cleans whitespace and cuts to 80 UTF-16 units without splitting a surrogate pair', () => {
    const s = state();
    expect(updateRecentTitle(s, 'a', '  示例\n\t公司   网申 ', 'jobs.example.com').recentPages[0]!.title).toBe('示例 公司 网申');
    const long = `${'a'.repeat(79)}😀tail`;
    const title = updateRecentTitle(s, 'a', long, 'jobs.example.com').recentPages[0]!.title!;
    expect(title).toBe('a'.repeat(79));
    expect(updateRecentTitle(s, 'a', 'b'.repeat(100), 'jobs.example.com').recentPages[0]!.title).toHaveLength(80);
  });

  it.each(['', '   ', 'about:blank', 'jobs.example.com', 'https://jobs.example.com/apply'])('leaves %j alone', (title) => {
    const s = state();
    expect(updateRecentTitle(s, 'a', title, 'jobs.example.com')).toBe(s);
  });

  it('the same title as stored returns the same state object', () => {
    const s = state();
    expect(updateRecentTitle(s, 'b', ' 旧标题 ', 'www.example.com')).toBe(s);
  });
});
