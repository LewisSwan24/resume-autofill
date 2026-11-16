// The tab bar's grid must have one column per tab, or the last tab wraps onto a second row (jsdom has no layout, so
// the stylesheet is read as text).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const src = join(__dirname, '../../../mobile/app/src');

describe('tab bar layout', () => {
  it('the grid has one column per tab', () => {
    const tabs = [...readFileSync(join(src, 'TabBar.tsx'), 'utf8').matchAll(/\{ tab: '[a-z]+', icon: /g)].length;
    expect(tabs).toBe(4);
    const css = readFileSync(join(src, 'styles.css'), 'utf8');
    const rule = /\n\.m-tabbar \{([^}]*)\}/.exec(css)?.[1] ?? '';
    expect(rule).toMatch(new RegExp(`grid-template-columns:\\s*repeat\\(${tabs},`));
  });
});
