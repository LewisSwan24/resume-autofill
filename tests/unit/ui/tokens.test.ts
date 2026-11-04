import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { HIGHLIGHT_COLORS, cssVarName, tokenEntries, tokens, tokensToCss } from '../../../src/ui/tokens';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** `--raf-name: value;` declarations of a CSS source, in order. */
function declarations(css: string): Array<[string, string]> {
  return [...stripComments(css).matchAll(/(--raf-[\w-]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1]!, m[2]!.trim()]);
}

const THEME_CSS = read('src/ui/theme.css');

describe('tokens.ts ↔ theme.css', () => {
  it('theme.css defines exactly the names and values of tokens.ts', () => {
    const fromCss = declarations(THEME_CSS);
    expect(new Set(fromCss.map(([n]) => n)).size, 'duplicate declarations in theme.css').toBe(fromCss.length);
    expect(Object.fromEntries(fromCss)).toEqual(Object.fromEntries(tokenEntries()));
  });

  it('theme.css applies to :root (pages), :host (shadow host) and .raf-root (inside the shadow tree)', () => {
    const selector = stripComments(THEME_CSS).split('{')[0]!;
    for (const s of [':root', ':host', '.raf-root']) expect(selector).toContain(s);
  });

  it('tokensToCss emits one --raf-* declaration per token on the given selector', () => {
    const css = tokensToCss('.x');
    expect(css.startsWith('.x {\n')).toBe(true);
    expect(declarations(css)).toEqual(tokenEntries());
    expect(css).toContain('--raf-color-primary: #');
  });

  it('every token name is unique, prefixed --raf- and has a non-empty value', () => {
    const entries = tokenEntries();
    expect(new Set(entries.map(([n]) => n)).size).toBe(entries.length);
    for (const [name, value] of entries) {
      expect(name).toMatch(/^--raf-[a-z0-9-]+$/);
      expect(value).not.toBe('');
    }
  });

  it('provides the canonical semantic names', () => {
    const names = new Set(tokenEntries().map(([n]) => n));
    const canonical = [
      ...['bg', 'surface', 'surface-hover', 'text', 'text-muted', 'primary', 'primary-hover', 'primary-text', 'border', 'success', 'warning', 'danger', 'focus'].map((k) => `--raf-color-${k}`),
      '--raf-font-sans',
      ...['xs', 'sm', 'md', 'lg'].map((k) => `--raf-font-size-${k}`),
      ...['regular', 'medium', 'strong'].map((k) => `--raf-font-weight-${k}`),
      '--raf-line-height',
      ...['sm', 'md', 'lg', 'pill'].map((k) => `--raf-radius-${k}`),
      ...[1, 2, 3, 4, 5, 6].map((k) => `--raf-space-${k}`),
      '--raf-shadow-1',
      '--raf-shadow-2',
      '--raf-motion-duration',
      '--raf-z-index',
    ];
    for (const n of canonical) expect(names.has(n), n).toBe(true);
    expect(cssVarName('color', 'primary')).toBe('--raf-color-primary');
    expect(tokens.typography['font-sans']).toMatch(/PingFang SC.*Microsoft YaHei/);
  });
});

describe('the three UIs only use shared tokens', () => {
  const defined = new Set(tokenEntries().map(([n]) => n));
  const files = [
    'entrypoints/options/options.css',
    'entrypoints/sidepanel/sidepanel.css',
    'entrypoints/fab.content/style.css',
  ];
  const COLOUR = /#[0-9a-fA-F]{3,8}\b|\brgba?\(|\bhsla?\(/;

  for (const file of files) {
    it(`${file}: no literal colours, no unknown --raf-* references`, () => {
      const css = stripComments(read(file));
      expect(css).not.toMatch(COLOUR);
      const local = new Set(declarations(css).map(([n]) => n));
      const used = [...css.matchAll(/var\((--raf-[\w-]+)/g)].map((m) => m[1]!);
      const unknown = used.filter((n) => !defined.has(n) && !local.has(n));
      expect([...new Set(unknown)]).toEqual([]);
      // Token values may only be redeclared locally for component-local sizes, never for shared names.
      expect([...local].filter((n) => defined.has(n))).toEqual([]);
    });
  }

  it('entrypoint TSX files contain no literal colours', () => {
    const tsx: string[] = [];
    for (const dir of ['options', 'sidepanel', 'fab.content']) {
      for (const f of readdirSync(path.join(ROOT, 'entrypoints', dir))) if (f.endsWith('.tsx')) tsx.push(`entrypoints/${dir}/${f}`);
    }
    expect(tsx.length).toBeGreaterThan(5);
    for (const f of tsx) expect(read(f), f).not.toMatch(COLOUR);
  });

  it('options, side panel and FAB import theme.css before their own stylesheet', () => {
    const cases: Array<[string, string]> = [
      ['entrypoints/options/App.tsx', './options.css'],
      ['entrypoints/sidepanel/App.tsx', './sidepanel.css'],
      ['entrypoints/fab.content/index.tsx', './style.css'],
    ];
    for (const [file, own] of cases) {
      const src = read(file);
      const theme = src.indexOf("import '../../src/ui/theme.css'");
      expect(theme, `${file} imports theme.css`).toBeGreaterThanOrEqual(0);
      expect(theme, `${file} order`).toBeLessThan(src.indexOf(`import '${own}'`));
    }
  });

  it('highlight outline colours come from tokens.ts', () => {
    expect(HIGHLIGHT_COLORS).toEqual({ filled: '#22c55e', review: '#eab308', error: '#ef4444' });
    const src = read('src/fill/highlight.ts');
    expect(src).toContain("from '../ui/tokens'");
    expect(src).not.toMatch(COLOUR);
  });
});
