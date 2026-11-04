/**
 * Design tokens: the single source of visual values for every UI of the extension
 * (options page, side panel, FAB inside its closed shadow root).
 *
 * The values come from Lewis's design system ("Lively Icons", docs/design-system/DESIGN-SYSTEM.md §2 and §6.1):
 * quiet screens, icon first, `paper` / `surface` / `tile` layers separated by 1px lines, NO drop shadows.
 * Dark mode has no hue except the status colours (danger, and the supplementary success / warning).
 *
 * Two themes exist for COLOUR tokens (`light`, `dark`); every other group is theme-independent.
 * `./theme.css` declares the light values on `:root, :host, .raf-root` and the dark values inside
 * `@media (prefers-color-scheme: dark)`; `tests/unit/ui/tokens.test.ts` keeps both files identical.
 *
 * Naming: every entry becomes the CSS custom property `--raf-<GROUP_PREFIX[group]><key>`,
 * e.g. `colorThemes.light.primary` → `--raf-color-primary`, `staticTokens.typography['font-size-md']` → `--raf-font-size-md`.
 */

export type ThemeName = 'light' | 'dark';
export const THEME_NAMES = ['light', 'dark'] as const satisfies readonly ThemeName[];

const light = {
  /** `paper`: page background. */
  bg: '#f5f5f7',
  /** `surface`: cards, rows, inputs, dialogs. */
  surface: '#ffffff',
  /** `tile`: hover / pressed fill of quiet controls, icon tiles. */
  'surface-hover': '#f0f0f3',
  /** `ink`. */
  text: '#2c2c2e',
  /** `ink-muted`. */
  'text-muted': '#636366',
  /** `accent`. */
  primary: '#0066cc',
  /** The design system does not change colour on hover (hover = extra 1px `ink` outline), so same value as primary. */
  'primary-hover': '#0066cc',
  /** `on-accent`. */
  'primary-text': '#ffffff',
  /** `line`: the only layering device (3.4:1). */
  border: '#8a8a8e',
  /** Supplementary (not in the design system). 6.55:1 on surface. */
  success: '#1a6b3a',
  /** Supplementary. 5.95:1 on surface. */
  warning: '#8f5700',
  /** `danger`. */
  danger: '#b3261e',
  /** `on-danger`: text / icons on a danger fill. */
  'on-danger': '#ffffff',
  /** Focus ring colour = `accent`. */
  focus: '#0066cc',
  /** Selected row / current item / pressed FilterChip background. */
  selected: '#e6f0fa',
  /** Text on `selected`. */
  'on-selected': '#004c99',
  /** `placeholder`: skeletons and tag-delete hover (decorative, never carries meaning). */
  placeholder: '#e0e0e4',
} as const;

type ColorKey = keyof typeof light;

const dark: Record<ColorKey, string> = {
  bg: '#111113',
  surface: '#1c1c1f',
  'surface-hover': '#2a2a2e',
  text: '#f5f5f5',
  'text-muted': '#a8a8b0',
  /** Dark has no colour: the accent is the brightest grey. */
  primary: '#f5f5f5',
  'primary-hover': '#f5f5f5',
  'primary-text': '#111113',
  border: '#77777f',
  /** Conservative supplementary status colours (DESIGN-SYSTEM §6.1 Dark column). */
  success: '#7fd6a0',
  warning: '#f2c066',
  danger: '#ff8a80',
  'on-danger': '#111113',
  focus: '#f5f5f5',
  selected: '#3a3a40',
  'on-selected': '#f5f5f5',
  placeholder: '#34343a',
};

/** Colour tokens of both themes. Both objects have exactly the same keys (enforced by the type above and by a test). */
export const colorThemes: { readonly light: Readonly<Record<ColorKey, string>>; readonly dark: Readonly<Record<ColorKey, string>> } = {
  light,
  dark,
};

/** Theme-independent tokens. */
export const staticTokens = {
  typography: {
    /** UI text. Manrope is bundled on extension pages only; the FAB (shadow root on a foreign page) falls back to the rest of the stack. */
    'font-sans': '"Manrope", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    /** Page titles only (ZCOOL KuaiLe is bundled on extension pages); never in buttons, lists, forms or body text. */
    'font-display': '"ZCOOL KuaiLe", "Manrope", "Noto Sans SC", "PingFang SC", "Microsoft YaHei", system-ui, sans-serif',
    /** `caption` is the Chinese floor (12px), so xs and sm are the same. */
    'font-size-xs': '12px',
    'font-size-sm': '12px',
    /** `label`: buttons, list item names, form labels. */
    'font-size-md': '13px',
    /** `body`. */
    'font-size-lg': '15px',
    /** `heading`. */
    'font-size-xl': '20px',
    /** `title`: page titles only. */
    'font-size-title': '28px',
    'font-weight-regular': '400',
    /** The design system has only 400 / 600, so `medium` is an alias of `strong`. */
    'font-weight-medium': '600',
    'font-weight-strong': '600',
    'line-height': '1.5',
    /** `label` and `caption`. */
    'line-height-tight': '1.4',
  },
  radius: {
    /** Checkbox, badge, skeleton, tag. */
    xs: '6px',
    /** Icon tile, icon button, tooltip, menu item. */
    sm: '8px',
    /** Button, input, card, dialog. */
    md: '12px',
    /** The design system has one card radius, so `lg` equals `md`. */
    lg: '12px',
    /** Switch, radio, spinner, search, chips only. */
    pill: '999px',
  },
  space: {
    '1': '4px',
    '2': '8px',
    '3': '12px',
    '4': '16px',
    '6': '24px',
  },
  shadow: {
    /** No shadows: layering is a 1px `line` border. The names stay so existing rules keep working. */
    '1': 'none',
    '2': 'none',
    /**
     * SUPPLEMENTARY, intentional deviation (DESIGN-SYSTEM §6.2-A): an outer white hairline, NOT a drop shadow, that
     * the FAB and the summary card may add so their edge stays readable on dark or busy host pages.
     */
    host: '0 0 0 1px rgb(255 255 255 / 60%)',
  },
  motion: {
    /** `--li-tint`: colour / border changes (never springy). */
    duration: '120ms',
    easing: 'ease-out',
    'duration-spinner': '900ms',
    /** `--li-move`: things that move or appear (slight spring). */
    move: '320ms cubic-bezier(.34, 1.56, .64, 1)',
    /** `--li-settle`: things that leave (no spring). */
    settle: '160ms ease-out',
  },
  zIndex: {
    /** Top-most overlay (the FAB host on the page). Deliberately NOT the design system's 1-6 layers. */
    index: '2147483647',
    /** Sticky page headers inside the extension's own pages (= `layer-sticky`). */
    sticky: '2',
  },
  /** Strokes, tints and opacities shared by interactive states. */
  state: {
    'border-width': '1px',
    'focus-ring-width': '2px',
    'focus-ring-offset': '2px',
    /** Share of a semantic colour mixed into transparent for soft chip / badge backgrounds (legacy; the UI tasks replace it with outlined badges). */
    /** Legacy: the design system uses `text-muted` instead of lowering opacity. */
    /** `States`: disabled controls are 45% opaque. */
    'opacity-disabled': '0.45',
    /** Legacy: the design system shows a spinner and `aria-busy` instead. */
  },
  /** Sizes of shared components. */
  size: {
    /** `size-hit`: icon buttons, inputs, menu items, table rows. */
    'icon-button': '36px',
    /** `size-icon`: inline SVG glyphs. */
    glyph: '20px',
    'spinner-width': '2px',
    'fab-height': '44px',
    /** Legacy (the FAB no longer wraps its icon in a round backdrop). */
    'fab-offset-x': '24px',
    'fab-offset-y': '24px',
    'card-width': '320px',
    'card-max-height': '70vh',
    'card-list-max-height': '220px',
  },
} as const;

export type StaticTokens = typeof staticTokens;
export type StaticTokenGroup = keyof StaticTokens;
export type TokenGroup = StaticTokenGroup | 'color';

/**
 * The default theme as one object (`color` = light), kept for code that reads a single value
 * (e.g. `tokens.typography['font-sans']`). Use `colorThemes` for the dark values.
 */
export const tokens = { color: colorThemes.light, ...staticTokens } as const;
export type Tokens = typeof tokens;

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

/** Theme-independent tokens as `[--raf-name, value]`, in declaration order. */
export function staticTokenEntries(): Array<[name: string, value: string]> {
  const out: Array<[string, string]> = [];
  for (const group of Object.keys(staticTokens) as StaticTokenGroup[]) {
    for (const [key, value] of Object.entries(staticTokens[group])) out.push([cssVarName(group, key), value]);
  }
  return out;
}

/** Colour tokens of one theme as `[--raf-color-*, value]`, in declaration order. */
export function colorTokenEntries(theme: ThemeName): Array<[name: string, value: string]> {
  return Object.entries(colorThemes[theme]).map(([key, value]) => [cssVarName('color', key), value]);
}

/**
 * Every token of one theme (colours of that theme, then the theme-independent ones) as `[--raf-name, value]`.
 * theme.css must declare exactly the `light` set on `:root, :host, .raf-root` and the `dark` COLOUR set
 * (see `colorTokenEntries`) inside the dark media block.
 */
export function tokenEntries(theme: ThemeName = 'light'): Array<[name: string, value: string]> {
  return [...colorTokenEntries(theme), ...staticTokenEntries()];
}

function toRule(selector: string, entries: Array<[string, string]>): string {
  const lines = entries.map(([name, value]) => `  ${name}: ${value};`);
  return `${selector} {\n${lines.join('\n')}\n}\n`;
}

/** One CSS rule declaring every token of `theme` as a `--raf-*` custom property on `selector`. */
export function tokensToCss(selector: string, theme: ThemeName = 'light'): string {
  return toRule(selector, tokenEntries(theme));
}

/** One CSS rule declaring only the colour tokens of `theme` on `selector`. */
export function colorTokensToCss(selector: string, theme: ThemeName): string {
  return toRule(selector, colorTokenEntries(theme));
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
