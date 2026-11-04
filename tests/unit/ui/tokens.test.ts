import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  HIGHLIGHT_COLORS,
  THEME_NAMES,
  colorThemes,
  colorTokenEntries,
  colorTokensToCss,
  cssVarName,
  staticTokenEntries,
  tokenEntries,
  tokens,
  tokensToCss,
} from '../../../src/ui/tokens';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const read = (rel: string): string => readFileSync(path.join(ROOT, rel), 'utf8');
const stripComments = (css: string): string => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** `--raf-name: value;` declarations of a CSS source, in order. */
function declarations(css: string): Array<[string, string]> {
  return [...stripComments(css).matchAll(/(--raf-[\w-]+)\s*:\s*([^;{}]+);/g)].map((m) => [m[1]!, m[2]!.trim()]);
}

const THEME_CSS = read('src/ui/theme.css');
const DARK_MEDIA = '@media (prefers-color-scheme: dark)';
const CLEAN_THEME_CSS = stripComments(THEME_CSS);
const DARK_AT = CLEAN_THEME_CSS.indexOf(DARK_MEDIA);
/** theme.css before the dark media query (light theme + theme-independent tokens), and the dark media block. */
const LIGHT_BLOCK = DARK_AT < 0 ? CLEAN_THEME_CSS : CLEAN_THEME_CSS.slice(0, DARK_AT);
const DARK_BLOCK = DARK_AT < 0 ? '' : CLEAN_THEME_CSS.slice(DARK_AT);
const SELECTORS = [':root', ':host', '.raf-root'];

describe('tokens.ts ↔ theme.css', () => {
  it('has a dark media block after the light block', () => {
    expect(DARK_AT, 'theme.css has @media (prefers-color-scheme: dark)').toBeGreaterThan(0);
    expect(CLEAN_THEME_CSS.split(DARK_MEDIA).length, 'exactly one dark media block').toBe(2);
  });

  it('light block: theme.css defines exactly the names and values of tokens.ts (light colours + static tokens)', () => {
    const fromCss = declarations(LIGHT_BLOCK);
    expect(new Set(fromCss.map(([n]) => n)).size, 'duplicate declarations in the light block').toBe(fromCss.length);
    expect(Object.fromEntries(fromCss)).toEqual(Object.fromEntries(tokenEntries('light')));
    expect(fromCss).toEqual(tokenEntries('light'));
  });

  it('dark block: theme.css overrides exactly the colour tokens, with the dark values of tokens.ts', () => {
    const fromCss = declarations(DARK_BLOCK);
    expect(new Set(fromCss.map(([n]) => n)).size, 'duplicate declarations in the dark block').toBe(fromCss.length);
    expect(Object.fromEntries(fromCss)).toEqual(Object.fromEntries(colorTokenEntries('dark')));
    expect(fromCss.every(([n]) => n.startsWith('--raf-color-'))).toBe(true);
    // No theme-independent token may be repeated in the dark block.
    const statics = new Set(staticTokenEntries().map(([n]) => n));
    expect(fromCss.filter(([n]) => statics.has(n))).toEqual([]);
  });

  it('every colour token exists in both themes and tokenEntries(dark) is complete', () => {
    expect(THEME_NAMES).toEqual(['light', 'dark']);
    expect(Object.keys(colorThemes.dark)).toEqual(Object.keys(colorThemes.light));
    for (const theme of THEME_NAMES) {
      for (const [key, value] of Object.entries(colorThemes[theme])) {
        expect(value, `${theme}.${key}`).toMatch(/^#[0-9a-f]{6}$/);
      }
    }
    expect(tokenEntries('dark').map(([n]) => n)).toEqual(tokenEntries('light').map(([n]) => n));
    expect(tokenEntries('dark').length).toBe(colorTokenEntries('dark').length + staticTokenEntries().length);
    // dark really differs from light (no accidental copy), and keeps no hue except status colours.
    for (const key of Object.keys(colorThemes.light) as Array<keyof typeof colorThemes.light>) {
      expect(colorThemes.dark[key], key).not.toBe(colorThemes.light[key]);
    }
  });

  it('theme.css applies to :root (pages), :host (shadow host) and .raf-root (inside the shadow tree) in both blocks', () => {
    const lightSelector = LIGHT_BLOCK.split('{')[0]!;
    const darkSelector = DARK_BLOCK.split('{')[1]!;
    for (const s of SELECTORS) {
      expect(lightSelector).toContain(s);
      expect(darkSelector).toContain(s);
    }
  });

  it('declares color-scheme: light dark so native controls follow the OS theme', () => {
    expect(LIGHT_BLOCK).toMatch(/color-scheme:\s*light dark;/);
  });

  it('tokensToCss / colorTokensToCss emit one --raf-* declaration per token on the given selector', () => {
    const css = tokensToCss('.x');
    expect(css.startsWith('.x {\n')).toBe(true);
    expect(declarations(css)).toEqual(tokenEntries('light'));
    expect(css).toContain('--raf-color-primary: #0066cc');
    expect(declarations(tokensToCss('.x', 'dark'))).toEqual(tokenEntries('dark'));
    expect(declarations(colorTokensToCss('.y', 'dark'))).toEqual(colorTokenEntries('dark'));
    expect(colorTokensToCss('.y', 'dark')).toContain('--raf-color-primary: #f5f5f5');
  });

  it('every token name is unique, prefixed --raf- and has a non-empty value', () => {
    for (const theme of THEME_NAMES) {
      const entries = tokenEntries(theme);
      expect(new Set(entries.map(([n]) => n)).size).toBe(entries.length);
      for (const [name, value] of entries) {
        expect(name).toMatch(/^--raf-[a-z0-9-]+$/);
        expect(value).not.toBe('');
      }
    }
  });

  it('provides the canonical semantic names', () => {
    const names = new Set(tokenEntries().map(([n]) => n));
    const canonical = [
      ...[
        'bg', 'surface', 'surface-hover', 'text', 'text-muted', 'primary', 'primary-hover', 'primary-text', 'border',
        'success', 'warning', 'danger', 'on-danger', 'focus', 'selected', 'on-selected', 'placeholder',
      ].map((k) => `--raf-color-${k}`),
      '--raf-font-sans',
      '--raf-font-display',
      ...['xs', 'sm', 'md', 'lg', 'xl', 'title'].map((k) => `--raf-font-size-${k}`),
      ...['regular', 'medium', 'strong'].map((k) => `--raf-font-weight-${k}`),
      '--raf-line-height',
      '--raf-line-height-tight',
      ...['xs', 'sm', 'md', 'lg', 'pill'].map((k) => `--raf-radius-${k}`),
      ...[1, 2, 3, 4, 6].map((k) => `--raf-space-${k}`),
      '--raf-shadow-1',
      '--raf-shadow-2',
      '--raf-shadow-host',
      '--raf-motion-duration',
      '--raf-motion-move',
      '--raf-motion-settle',
      '--raf-z-index',
    ];
    for (const n of canonical) expect(names.has(n), n).toBe(true);
    expect(cssVarName('color', 'primary')).toBe('--raf-color-primary');
    expect(tokens.typography['font-sans']).toMatch(/PingFang SC.*Microsoft YaHei/);
  });

  it('follows the design system values (DESIGN-SYSTEM §6.1)', () => {
    const light = Object.fromEntries(tokenEntries('light'));
    expect(light['--raf-font-sans']).toBe('"Manrope", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif');
    expect(light['--raf-font-display']).toMatch(/^"ZCOOL KuaiLe", /);
    expect(light['--raf-font-size-title']).toBe('28px');
    expect(light['--raf-shadow-1']).toBe('none');
    expect(light['--raf-shadow-2']).toBe('none');
    expect(light['--raf-motion-duration-spinner']).toBe('900ms');
    expect(light['--raf-motion-move']).toBe('320ms cubic-bezier(.34, 1.56, .64, 1)');
    expect(light['--raf-motion-settle']).toBe('160ms ease-out');
    expect(light['--raf-opacity-disabled']).toBe('0.45');
    expect(light['--raf-size-icon-button']).toBe('36px');
    expect(light['--raf-size-glyph']).toBe('20px');
    expect(light['--raf-z-index']).toBe('2147483647');
    expect(light['--raf-font-weight-medium']).toBe('600');
    expect(colorThemes.light.primary).toBe('#0066cc');
    expect(colorThemes.dark.success).toBe('#7fd6a0');
    expect(colorThemes.dark.warning).toBe('#f2c066');
    expect(colorThemes.dark.danger).toBe('#ff8a80');
    // Only 400 / 600 weights exist in the system.
    for (const k of ['regular', 'medium', 'strong']) expect(['400', '600']).toContain(light[`--raf-font-weight-${k}`]);
  });
});
describe('the three UIs only use shared tokens', () => {
  const defined = new Set(tokenEntries().map(([n]) => n));
  const files = [
    'entrypoints/options/options.css',
    'entrypoints/options/ui/ui.css',
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

