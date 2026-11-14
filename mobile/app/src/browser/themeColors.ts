// The UI's colour tokens as ARGB ints for the native FAB, scrim and page background. `--m-scrim` is a
// color-mix(), which getComputedStyle does not hand back as hex, so each token is resolved on a probe element and,
// unless it is already plain rgb(), painted on a 1×1 canvas and read back. Re-resolves when the colour scheme flips.
import type { NativeTheme } from './native';

const TOKENS: Record<keyof NativeTheme, string> = {
  bg: '--raf-color-bg',
  surface: '--raf-color-surface',
  text: '--raf-color-text',
  line: '--raf-color-border',
  accent: '--raf-color-primary',
  scrim: '--m-scrim',
};

/** Light-theme values of theme.css, used when a token cannot be read (no layout engine, no canvas). */
const FALLBACK: NativeTheme = {
  bg: argb(255, 0xf5, 0xf5, 0xf7),
  surface: argb(255, 0xff, 0xff, 0xff),
  text: argb(255, 0x2c, 0x2c, 0x2e),
  line: argb(255, 0x8a, 0x8a, 0x8e),
  accent: argb(255, 0x00, 0x66, 0xcc),
  scrim: argb(191, 0xf5, 0xf5, 0xf7),
};

/** Signed 32-bit ARGB, the way Android's Color ints are. */
export function argb(a: number, r: number, g: number, b: number): number {
  return ((a & 0xff) << 24) | ((r & 0xff) << 16) | ((g & 0xff) << 8) | (b & 0xff);
}

/** rgb(r, g, b) / rgba(r, g, b, a) / rgb(r g b / a) → ARGB; anything else → null. */
export function parseRgb(css: string): number | null {
  const m = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(css.trim());
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith('%') ? Number.parseFloat(m[4]) / 100 : Number.parseFloat(m[4]);
  const c = (v: string) => Math.max(0, Math.min(255, Math.round(Number.parseFloat(v))));
  return argb(Math.round(Math.max(0, Math.min(1, alpha)) * 255), c(m[1]!), c(m[2]!), c(m[3]!));
}

let canvas: HTMLCanvasElement | null = null;
function paint(css: string): number | null {
  try {
    canvas ??= document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return null;
    ctx.clearRect(0, 0, 1, 1);
    const sentinel = '#010203';
    ctx.fillStyle = sentinel;
    ctx.fillStyle = css; // a colour the canvas cannot parse leaves the sentinel
    if (ctx.fillStyle === sentinel) return null;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return argb(a!, r!, g!, b!);
  } catch {
    return null;
  }
}

/** Resolve every token on the document as it is styled now. */
export function resolveTheme(doc: Document = document): NativeTheme {
  const probe = doc.createElement('span');
  probe.setAttribute('aria-hidden', 'true');
  probe.style.position = 'absolute';
  probe.style.visibility = 'hidden';
  doc.body.append(probe);
  const out = { ...FALLBACK };
  try {
    for (const key of Object.keys(TOKENS) as (keyof NativeTheme)[]) {
      probe.style.color = '';
      probe.style.color = `var(${TOKENS[key]})`;
      const css = doc.defaultView?.getComputedStyle(probe).color ?? '';
      if (!css || css.includes('var(')) continue;
      const value = parseRgb(css) ?? (typeof doc.defaultView?.HTMLCanvasElement === 'function' && isRealCanvas() ? paint(css) : null);
      if (value !== null) out[key] = value;
    }
  } finally {
    probe.remove();
  }
  return out;
}

/** jsdom has a canvas element without a 2D context; asking for one only logs "not implemented". */
function isRealCanvas(): boolean {
  return typeof navigator !== 'undefined' && !/jsdom/i.test(navigator.userAgent);
}

/** Calls back with a fresh theme whenever the system colour scheme changes. */
export function onSchemeChange(cb: (theme: NativeTheme) => void): () => void {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return () => undefined;
  const query = window.matchMedia('(prefers-color-scheme: dark)');
  // Tokens switch in the same frame as the media query; read them on the next one.
  const listener = () => requestAnimationFrame(() => cb(resolveTheme()));
  query.addEventListener?.('change', listener);
  return () => query.removeEventListener?.('change', listener);
}
