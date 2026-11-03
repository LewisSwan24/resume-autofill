import { discover } from '../../../src/engine/discover';
import type { Control, OptionInfo } from '../../../src/engine/types';
import type { DriverContext, FillIntent, OptionMatch } from '../../../src/drivers/types';

export function mount(html: string): HTMLElement {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.appendChild(host);
  return host;
}

export function controlsOf(html: string): Control[] {
  mount(html);
  return discover(document);
}

export function firstControl(html: string): Control {
  const c = controlsOf(html)[0];
  if (!c) throw new Error('no control discovered');
  return c;
}

export const ctx1: DriverContext = { doc: document, attempt: 1, timeoutMs: 1000 };
export const ctx2: DriverContext = { doc: document, attempt: 2, timeoutMs: 1000 };

/** Matcher by exact case-insensitive label: ambiguous on several hits, none on zero. */
export function byLabel(query: string): (options: OptionInfo[]) => OptionMatch {
  return (options) => {
    const hits = options.flatMap((o, i) =>
      !o.disabled && o.label.trim().toLowerCase() === query.toLowerCase() ? [i] : [],
    );
    if (hits.length === 0) return { status: 'none' };
    if (hits.length > 1) return { status: 'ambiguous', candidates: hits };
    return { status: 'matched', index: hits[0]!, confidence: 1 };
  };
}

export const choice = (label: string): FillIntent => ({
  kind: 'choice',
  display: label,
  query: label,
  match: byLabel(label),
});

export const multi = (...labels: string[]): FillIntent => ({
  kind: 'multi',
  display: labels.join(', '),
  items: labels.map((l) => ({ query: l, match: byLabel(l) })),
});

/** Record the types of events an element receives. */
export function record(el: Element, types: string[]): string[] {
  const log: string[] = [];
  for (const t of types) el.addEventListener(t, () => log.push(t));
  return log;
}
