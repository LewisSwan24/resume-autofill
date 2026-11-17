// Resilient compound DOM fingerprint extraction & weighted matching for SiteRecipe rules.
import { normalizeLabel } from '../dictionary';
import { parentElementOrHost } from '../engine/shadow';
import type { Control, Evidence } from '../engine/types';
import type { SiteRecipeFingerprint } from '../schema';

const MAX_TOKENS = 16;

export function tokenizeLabel(text: string): string[] {
  const norm = normalizeLabel(text);
  if (!norm) return [];
  const raw = norm
    .split(/[\s/_|·,.;:：()（）\[\]【】]+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 1);
  return Array.from(new Set(raw)).slice(0, MAX_TOKENS);
}

/** Build a stable structural breadcrumb ignoring hashed CSS class names. */
export function buildStructuralPath(el: Element, maxDepth = 4): string {
  const parts: string[] = [];
  let current: Element | null = el;
  for (let i = 0; i < maxDepth && current; i++) {
    const tag = current.tagName.toLowerCase();
    const role = current.getAttribute('role');
    const attr = role ? `[role=${role}]` : '';
    const parent = parentElementOrHost(current);
    let nth = '';
    if (parent && parent.children) {
      const sameTag = Array.from(parent.children).filter((c) => c.tagName === current!.tagName);
      if (sameTag.length > 1) {
        nth = `:nth(${sameTag.indexOf(current) + 1})`;
      }
    }
    parts.unshift(`${tag}${attr}${nth}`);
    current = parent;
  }
  return parts.join('>');
}

export function captureFieldFingerprint(
  control: Pick<Control, 'el' | 'inputType' | 'kind'>,
  evidence: readonly Evidence[],
): SiteRecipeFingerprint {
  const el = control.el;
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute('role') ?? undefined;
  const inputType =
    el instanceof HTMLInputElement
      ? el.type || 'text'
      : control.inputType || el.getAttribute('type') || undefined;
  const nameAttr = el.getAttribute('name') || undefined;
  const autocomplete = el.getAttribute('autocomplete') || undefined;
  const placeholder = el.getAttribute('placeholder')?.slice(0, 160) || undefined;
  const combinedLabel = evidence
    .filter((e) => e.source !== 'fine-print')
    .slice(0, 3)
    .map((e) => e.text)
    .join(' ');
  const labelTokens = tokenizeLabel(combinedLabel);
  const structuralPath = buildStructuralPath(el);

  return {
    tag,
    ...(role ? { role } : {}),
    ...(inputType ? { inputType } : {}),
    ...(nameAttr ? { nameAttr } : {}),
    ...(autocomplete ? { autocomplete } : {}),
    ...(placeholder ? { placeholder } : {}),
    labelTokens,
    ...(structuralPath ? { structuralPath } : {}),
  };
}

function jaccard(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const setA = new Set(a);
  const setB = new Set(b);
  let hits = 0;
  for (const x of setA) if (setB.has(x)) hits++;
  return hits / (setA.size + setB.size - hits);
}

export const RECIPE_MATCH_THRESHOLD = 0.65;

/** Score how strongly a live control matches a recorded SiteRecipeFingerprint (0..1). */
export function scoreFingerprintMatch(
  candidate: SiteRecipeFingerprint,
  target: SiteRecipeFingerprint,
): number {
  if (candidate.tag !== target.tag && candidate.role !== target.role) {
    return 0;
  }
  if (target.inputType && candidate.inputType && target.inputType !== candidate.inputType) {
    return 0;
  }

  let weightSum = 0;
  let scoreSum = 0;

  if (target.nameAttr) {
    weightSum += 0.35;
    if (candidate.nameAttr === target.nameAttr) scoreSum += 0.35;
  }
  if (target.autocomplete) {
    weightSum += 0.15;
    if (candidate.autocomplete === target.autocomplete) scoreSum += 0.15;
  }
  if (target.placeholder) {
    weightSum += 0.15;
    if (
      candidate.placeholder &&
      normalizeLabel(candidate.placeholder) === normalizeLabel(target.placeholder)
    ) {
      scoreSum += 0.15;
    }
  }
  if (target.labelTokens.length > 0) {
    weightSum += 0.45;
    scoreSum += 0.45 * jaccard(candidate.labelTokens, target.labelTokens);
  }
  if (target.structuralPath) {
    weightSum += 0.15;
    if (candidate.structuralPath === target.structuralPath) scoreSum += 0.15;
  }

  if (weightSum === 0) return candidate.tag === target.tag ? 0.5 : 0;
  return Number((scoreSum / weightSum).toFixed(4));
}
