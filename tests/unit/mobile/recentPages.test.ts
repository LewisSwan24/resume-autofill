// Recent application pages kept in app state: newest first, one entry per link (the #fragment ignored), at most 30.
import { describe, expect, it } from 'vitest';
import { RECENT_PAGES_MAX } from '../../../mobile/app/src/store/appStateStore';
import { AppStateV1Schema, type AppStateV1 } from '../../../mobile/app/src/store/appStateMigrate';

// Legacy helpers on the v1 shape.
const defaultAppState = (o: Partial<AppStateV1> = {}): AppStateV1 => AppStateV1Schema.parse({ version: 1, ...o });
import {
  addRecentPage,
  clearRecentPages,
  recentKey,
  removeRecentPage,
  restoreRecentPages,
} from '../../../mobile/app/src/store/recentPages';

const ids = () => {
  let n = 0;
  return () => `id${++n}`;
};

describe('recent pages', () => {
  it('recentKey drops the #fragment only', () => {
    expect(recentKey('https://jobs.example.com/apply/1?a=b#step2')).toBe('https://jobs.example.com/apply/1?a=b');
    expect(recentKey('https://jobs.example.com/apply/1')).toBe('https://jobs.example.com/apply/1');
  });

  it('adds a page at the top with a new id and the time given', () => {
    const next = ids();
    let state = addRecentPage(defaultAppState(), { url: 'https://a.example.com/1', host: 'a.example.com' }, 100, next);
    state = addRecentPage(state, { url: 'https://b.example.com/2', host: 'b.example.com', title: '示例科技' }, 200, next);
    expect(state.recentPages).toEqual([
      { id: 'id2', url: 'https://b.example.com/2', host: 'b.example.com', title: '示例科技', addedAt: 200 },
      { id: 'id1', url: 'https://a.example.com/1', host: 'a.example.com', addedAt: 100 },
    ]);
  });

  it('uses a random id when none is given', () => {
    const state = addRecentPage(defaultAppState(), { url: 'https://a.example.com/1', host: 'a.example.com' }, 1);
    expect(state.recentPages[0]!.id).toMatch(/^.{1,64}$/);
  });

  it('the same link again (ignoring #fragment) moves to the top, keeps its id, takes a new title only when given', () => {
    const next = ids();
    let state = addRecentPage(defaultAppState(), { url: 'https://a.example.com/1', host: 'a.example.com', title: '旧标题' }, 1, next);
    state = addRecentPage(state, { url: 'https://b.example.com/2', host: 'b.example.com' }, 2, next);
    state = addRecentPage(state, { url: 'https://a.example.com/1#x', host: 'a.example.com' }, 3, next);
    expect(state.recentPages.map((p) => p.id)).toEqual(['id1', 'id2']);
    expect(state.recentPages[0]).toEqual({
      id: 'id1',
      url: 'https://a.example.com/1#x',
      host: 'a.example.com',
      title: '旧标题',
      addedAt: 3,
    });
    state = addRecentPage(state, { url: 'https://a.example.com/1', host: 'a.example.com', title: '新标题' }, 4, next);
    expect(state.recentPages).toHaveLength(2);
    expect(state.recentPages[0]!.title).toBe('新标题');
  });

  it('keeps at most 30, dropping the oldest', () => {
    const next = ids();
    let state = defaultAppState();
    for (let i = 0; i < 35; i += 1) {
      state = addRecentPage(state, { url: `https://a.example.com/${i}`, host: 'a.example.com' }, i, next);
    }
    expect(RECENT_PAGES_MAX).toBe(30);
    expect(state.recentPages).toHaveLength(30);
    expect(state.recentPages[0]!.url).toBe('https://a.example.com/34');
    expect(state.recentPages[29]!.url).toBe('https://a.example.com/5');
  });

  it('removes one by id; clears all; restores a saved list', () => {
    const next = ids();
    let state = addRecentPage(defaultAppState(), { url: 'https://a.example.com/1', host: 'a.example.com' }, 1, next);
    state = addRecentPage(state, { url: 'https://b.example.com/2', host: 'b.example.com' }, 2, next);
    const saved = state.recentPages;
    const removed = removeRecentPage(state, 'id1');
    expect(removed.recentPages.map((p) => p.id)).toEqual(['id2']);
    const cleared = clearRecentPages(state);
    expect(cleared.recentPages).toEqual([]);
    expect(cleared.fillLanguage).toBe(state.fillLanguage);
    expect(restoreRecentPages(cleared, saved).recentPages).toEqual(saved);
    // pure: the input is untouched
    expect(state.recentPages).toHaveLength(2);
  });

  it('undo keeps a link added after the remove or clear, and does not list one link twice', () => {
    const next = ids();
    let state = addRecentPage(defaultAppState(), { url: 'https://a.example.com/1', host: 'a.example.com' }, 1, next);
    state = addRecentPage(state, { url: 'https://b.example.com/2', host: 'b.example.com' }, 2, next);
    const before = state.recentPages; // id2 (b), id1 (a)
    let after = removeRecentPage(state, 'id1');
    after = addRecentPage(after, { url: 'https://c.example.com/3', host: 'c.example.com' }, 3, next);
    expect(restoreRecentPages(after, before).recentPages.map((p) => p.id)).toEqual(['id3', 'id2', 'id1']);
    // cleared, then a link pasted again that was in the old list: it stays once, the newer entry
    let cleared = clearRecentPages(state);
    cleared = addRecentPage(cleared, { url: 'https://a.example.com/1#top', host: 'a.example.com' }, 4, next);
    expect(restoreRecentPages(cleared, before).recentPages.map((p) => p.id)).toEqual(['id4', 'id2']);
  });
});
