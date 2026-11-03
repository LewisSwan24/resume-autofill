// Scan: discover → evidence/grouping → classification for one document (or shadow root).
import { FILL_THRESHOLD, classifyAll } from './classify';
import { discover } from './discover';
import { buildFieldContext } from './grouping';
import type { Classification, FieldContext } from './types';

export interface ScanResult {
  contexts: FieldContext[];
  /** Same order as `contexts`. */
  classifications: Classification[];
  /** Controls classified confidently enough to be filled (before looking at resume data). */
  fillableCount: number;
}

/**
 * Scan a document. `idFor` keeps control ids stable across rescans (callers hold a WeakMap<Element, string>).
 * Used by the content script for the FAB badge and by runFill.
 */
export function scanDocument(doc: Document | ShadowRoot, idFor?: (el: HTMLElement) => string): ScanResult {
  const controls = discover(doc, idFor ? { idFor } : {});
  const contexts = controls.map(buildFieldContext);
  const classifications = classifyAll(contexts);
  const fillableCount = classifications.filter(
    (c) => c.fieldKey !== null && c.confidence >= FILL_THRESHOLD - 1e-9,
  ).length;
  return { contexts, classifications, fillableCount };
}
