import { describe, expect, it } from 'vitest';
import { OUTCOMES } from '../../../src/engine/types';
import { DICTIONARIES, translate } from '../../../src/i18n';
import { ICON_NAMES } from '../../../src/ui/Icon';
import { groupOf, OUTCOME_STATUS, STATUS_GROUPS, TONE_COLOR_VAR, type StatusGroupId } from '../../../src/ui/status';
import { tokenEntries } from '../../../src/ui/tokens';

describe('OUTCOME_STATUS', () => {
  it('has an entry for every outcome', () => {
    expect(Object.keys(OUTCOME_STATUS).sort()).toEqual([...OUTCOMES].sort());
  });

  it('maps tone and icon as in DESIGN-SYSTEM §6.3', () => {
    const view = Object.fromEntries(OUTCOMES.map((o) => [o, [OUTCOME_STATUS[o].tone, OUTCOME_STATUS[o].icon]]));
    expect(view).toEqual({
      filled: ['success', 'check-circle'],
      needs_review: ['warning', 'exclamation-circle'],
      no_option: ['warning', 'exclamation-circle'],
      unmatched: ['danger', 'question-circle'],
      action_failed: ['danger', 'x-circle'],
      no_data: ['muted', 'info-circle'],
      no_control: ['muted', 'info-circle'],
    });
  });

  it('only uses registered icons and defined colour tokens', () => {
    const defined = new Set(tokenEntries().map(([n]) => n));
    for (const o of OUTCOMES) expect(ICON_NAMES).toContain(OUTCOME_STATUS[o].icon);
    for (const v of Object.values(TONE_COLOR_VAR)) expect(defined.has(v.slice(4, -1)), v).toBe(true);
  });

  it('has a label key in both languages with the neutral wording', () => {
    const en = Object.fromEntries(OUTCOMES.map((o) => [o, translate('en', OUTCOME_STATUS[o].labelKey)]));
    const zh = Object.fromEntries(OUTCOMES.map((o) => [o, translate('zh', OUTCOME_STATUS[o].labelKey)]));
    expect(en).toEqual({
      filled: 'Filled',
      needs_review: 'Needs review',
      no_option: 'No matching option',
      unmatched: 'Not recognized',
      action_failed: 'Fill failed',
      no_data: 'No data in resume',
      no_control: 'No control',
    });
    expect(zh).toEqual({
      filled: '已填写',
      needs_review: '待确认',
      no_option: '没有匹配的选项',
      unmatched: '未识别',
      action_failed: '填写失败',
      no_data: '简历里没有',
      no_control: '没有控件',
    });
  });

  it('keeps the status.* key set identical in zh and en, and labels are distinct per icon+word', () => {
    const keys = (d: Readonly<Record<string, string>>) => Object.keys(d).filter((k) => k.startsWith('status.')).sort();
    // status.entry_held words a row for an entry the page already holds; it is not an outcome.
    const outcomeKeys = (d: Readonly<Record<string, string>>) =>
      keys(d).filter((k) => !k.startsWith('status.group.') && k !== 'status.entry_held');
    expect(keys(DICTIONARIES.zh)).toEqual(keys(DICTIONARIES.en));
    expect(outcomeKeys(DICTIONARIES.en)).toHaveLength(OUTCOMES.length);
    const labels = OUTCOMES.map((o) => DICTIONARIES.en[OUTCOME_STATUS[o].labelKey]);
    expect(new Set(labels).size).toBe(OUTCOMES.length);
  });
});

describe('STATUS_GROUPS / groupOf', () => {
  const GROUP_IDS = Object.keys(STATUS_GROUPS) as StatusGroupId[];

  it('has the four groups in display order: filled, review, failed, nodata', () => {
    expect(GROUP_IDS).toEqual(['filled', 'review', 'failed', 'nodata']);
  });

  it('groups outcomes by tone: review = needs_review + no_option, failed = unmatched + action_failed, nodata = no_data (+ no_control)', () => {
    const view = Object.fromEntries(OUTCOMES.map((o) => [o, groupOf(o)]));
    expect(view).toEqual({
      filled: 'filled',
      needs_review: 'review',
      no_option: 'review',
      unmatched: 'failed',
      action_failed: 'failed',
      no_data: 'nodata',
      no_control: 'nodata',
    });
  });

  it('gives each group the tone of its outcomes, a registered icon and a distinct word in both languages', () => {
    for (const o of OUTCOMES) expect(STATUS_GROUPS[groupOf(o)].tone, o).toBe(OUTCOME_STATUS[o].tone);
    for (const g of GROUP_IDS) expect(ICON_NAMES).toContain(STATUS_GROUPS[g].icon);
    const words = (lang: 'en' | 'zh') => GROUP_IDS.map((g) => translate(lang, STATUS_GROUPS[g].labelKey));
    expect(words('en')).toEqual(['Filled', 'Needs review', 'Not filled', 'No data in resume']);
    expect(words('zh')).toEqual(['已填写', '待确认', '未填写', '简历里没有']);
    expect(new Set(words('en')).size).toBe(GROUP_IDS.length);
  });

  it('keeps status.group.* identical in zh and en', () => {
    const keys = (d: Readonly<Record<string, string>>) => Object.keys(d).filter((k) => k.startsWith('status.group.')).sort();
    expect(keys(DICTIONARIES.zh)).toEqual(keys(DICTIONARIES.en));
    expect(keys(DICTIONARIES.en)).toHaveLength(GROUP_IDS.length);
  });
});
