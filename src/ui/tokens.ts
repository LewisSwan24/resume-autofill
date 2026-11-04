/**
 * Design tokens: the single source of visual values for every UI of the extension
 * (options page, side panel, FAB inside its closed shadow root).
 *
 * The values below are NEUTRAL PLACEHOLDERS. To adopt Lewis's design system, replace the values here
 * and the matching declarations in `./theme.css` (a unit test keeps both files identical), nothing else.
 *
 * Naming: every entry becomes the CSS custom property `--raf-<GROUP_PREFIX[group]><key>`,
 * e.g. `tokens.color.primary` → `--raf-color-primary`, `tokens.typography['font-size-md']` → `--raf-font-size-md`.
 */
export const tokens = {
  color: {
    bg: '#f6f7f9',
    surface: '#ffffff',
    'surface-hover': '#f0f2f5',
    text: '#1f2329',
    'text-muted': '#6b7280',
    primary: '#2563eb',
    'primary-hover': '#1d4ed8',
    'primary-text': '#ffffff',
    border: '#e1e4ea',
    success: '#1b7f3b',
    warning: '#b26a00',
    danger: '#c62828',
    focus: '#7aa5ff',
  },
  typography: {
    'font-sans': "system-ui, -apple-system, 'Segoe UI', 'PingFang SC', 'Microsoft YaHei', sans-serif",
    'font-size-xs': '11px',
    'font-size-sm': '12px',
    'font-size-md': '13px',
    'font-size-lg': '14px',
    'font-size-xl': '16px',
    'font-weight-regular': '400',
    'font-weight-medium': '500',
    'font-weight-strong': '600',
    'line-height': '1.45',
  },
  radius: {
    sm: '4px',
    md: '6px',
    lg: '12px',
    pill: '999px',
  },
  space: {
    '1': '4px',
    '2': '8px',
    '3': '12px',
    '4': '16px',
    '5': '20px',
    '6': '24px',
  },
  shadow: {
    '1': '0 1px 2px rgb(16 24 40 / 10%), 0 1px 3px rgb(16 24 40 / 8%)',
    '2': '0 8px 24px rgb(16 24 40 / 18%), 0 2px 6px rgb(16 24 40 / 12%)',
  },
  motion: {
    duration: '140ms',
    easing: 'ease',
    'duration-spinner': '800ms',
  },
  zIndex: {
    /** Top-most overlay (the FAB host on the page). */
    index: '2147483647',
    /** Sticky page headers inside the extension's own pages. */
    sticky: '2',
  },
  /** Strokes, tints and opacities shared by interactive states. */
  state: {
    'border-width': '1px',
    'focus-ring-width': '2px',
    'focus-ring-offset': '2px',
    /** Share of a semantic colour mixed into transparent for soft chip / badge backgrounds. */
    'tint-strength': '14%',
    'opacity-muted': '0.72',
    'opacity-disabled': '0.5',
    'opacity-busy': '0.85',
  },
  /** Sizes of shared components. */
  size: {
    'icon-button': '28px',
    glyph: '16px',
    'spinner-width': '2px',
    'fab-height': '44px',
    'fab-icon': '28px',
    'fab-offset-x': '24px',
    'fab-offset-y': '24px',
    'card-width': '320px',
    'card-max-height': '70vh',
    'card-list-max-height': '220px',
  },
} as const;

export type Tokens = typeof tokens;
export type TokenGroup = keyof Tokens;

/** CSS custom property prefix (after `--raf-`) for each group. */
export const GROUP_PREFIX = {
  color: 'color-',
  typography: '',
  radius: 'radius-',
  space: 'space-',
  shadow: 'shadow-',
  motion: 'motion-',
  zIndex: 'z-',
  state: '',
  size: 'size-',
} as const satisfies Record<TokenGroup, string>;

/** `--raf-*` name of one token. */
export function cssVarName(group: TokenGroup, key: string): string {
  return `--raf-${GROUP_PREFIX[group]}${key}`;
}

/** Every token as `[--raf-name, value]`, in declaration order. */
export function tokenEntries(): Array<[name: string, value: string]> {
  const out: Array<[string, string]> = [];
  for (const group of Object.keys(tokens) as TokenGroup[]) {
    for (const [key, value] of Object.entries(tokens[group])) out.push([cssVarName(group, key), value]);
  }
  return out;
}

/** One CSS rule declaring every token as a `--raf-*` custom property on `selector`. */
export function tokensToCss(selector: string): string {
  const lines = tokenEntries().map(([name, value]) => `  ${name}: ${value};`);
  return `${selector} {\n${lines.join('\n')}\n}\n`;
}

/**
 * Colours of the outlines drawn on the HOST page by `src/fill/highlight.ts`. Inline styles on a foreign
 * page cannot use our CSS variables, so these are plain constants (kept deliberately brighter than the UI palette).
 */
export const HIGHLIGHT_COLORS = {
  filled: '#22c55e',
  review: '#eab308',
  error: '#ef4444',
} as const;
