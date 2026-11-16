// Launcher shortcuts carry ids only; their labels come from the record.
import { describe, expect, it } from 'vitest';
import { mt } from '../../../../mobile/app/src/i18n';
import { buildShortcutSync, lastApplication, shortcutItemFor } from '../../../../mobile/app/src/shortcuts/shortcutList';
import { ApplicationRecordSchema, defaultAppState, type ApplicationRecord } from '../../../../mobile/app/src/store/appStateStore';

const rec = (id: string, over: Partial<ApplicationRecord> = {}): ApplicationRecord =>
  ApplicationRecordSchema.parse({
    id,
    url: `https://jobs.example.com/${id}`,
    host: 'jobs.example.com',
    statusAt: 1,
    createdAt: 1,
    openedAt: 1,
    updatedAt: 1,
    ...over,
  });
const zh = (key: string, params?: Record<string, string | number>) => mt('zh', key, params);

describe('lastApplication', () => {
  it('last application is the most recently opened, not 结束', () => {
    const records = [
      rec('a', { openedAt: 30, status: 'closed', company: '示例银行' }),
      rec('b', { openedAt: 20, company: '示例科技' }),
      rec('c', { openedAt: 25, status: 'submitted' }),
    ];
    expect(lastApplication(records)?.id).toBe('c');
    expect(lastApplication([records[0]!])).toBeNull();
  });

  it('none without records', () => {
    expect(lastApplication([])).toBeNull();
    expect(buildShortcutSync(defaultAppState(), zh)).toEqual({ dynamic: [], liveRecordIds: [], disabledMessage: '这条网申记录已删除' });
  });
});

describe('shortcutItemFor', () => {
  it('labels are clipped by graphemes', () => {
    const long = rec('x', { company: '示例科技有限公司华东分公司二〇二七届校园招聘入口' });
    const item = shortcutItemFor(long, zh, 'pinned');
    expect(item).toMatchObject({ id: 'app-x', recordId: 'x', shortLabel: '示例科技有限公司华东' });
    expect(Array.from(item.longLabel)).toHaveLength(25);
    expect(item.longLabel.startsWith('继续：示例科技')).toBe(true);
    // An emoji ZWJ family counts as one grapheme and is never split.
    const family = '👨‍👩‍👧';
    const emoji = shortcutItemFor(rec('y', { company: `${family.repeat(12)}` }), zh, 'dynamic');
    expect(emoji.id).toBe('last-application');
    expect(emoji.shortLabel).toBe(family.repeat(10));
    // No company: the host stands in.
    expect(shortcutItemFor(rec('z'), (k, p) => mt('en', k, p), 'dynamic')).toMatchObject({ shortLabel: 'jobs.examp', longLabel: 'Continue: jobs.example.co' });
  });
});

describe('buildShortcutSync', () => {
  it('an id Android would refuse is left out, so it cannot block the sync for every record', () => {
    const state = defaultAppState({ applications: [rec('a_1', { openedAt: 30 }), rec('b', { openedAt: 20 })] });
    const sync = buildShortcutSync(state, zh);
    expect(sync.liveRecordIds).toEqual(['b']);
    expect(sync.dynamic.map((d) => d.recordId)).toEqual(['b']);
  });

  it('sync payload lists live record ids', () => {
    const state = defaultAppState({ applications: [rec('b', { openedAt: 20, company: '示例科技' }), rec('a', { openedAt: 10, status: 'closed' })] });
    expect(buildShortcutSync(state, zh)).toEqual({
      dynamic: [{ id: 'last-application', recordId: 'b', shortLabel: '示例科技', longLabel: '继续：示例科技' }],
      liveRecordIds: ['b', 'a'],
      disabledMessage: '这条网申记录已删除',
    });
  });
});
