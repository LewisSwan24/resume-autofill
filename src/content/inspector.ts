// Pure DOM interactive Point-and-Record Field Inspector across light DOM & Open ShadowRoots.
// Zero window.postMessage calls and zero host DOM style mutations.
import { classifyAll } from '../engine/classify';
import { collectEvidence, FIELD_SELECTOR } from '../engine/evidence';
import { captureFieldFingerprint } from '../recipes';
import type { Control, FieldKey, SectionKey } from '../engine/types';
import type { SiteRecipeFingerprint } from '../schema';

export interface InspectorTargetInfo {
  rect: { left: number; top: number; width: number; height: number };
  label: string;
  fieldKey: FieldKey | null;
  section: SectionKey | null;
  confidence: number;
  tag: string;
  fingerprint: SiteRecipeFingerprint;
}

export interface InspectorController {
  active(): boolean;
  start(): void;
  stop(): void;
}

/** Drill through nested Open Shadow DOM hosts at viewport point (x, y). */
export function deepElementFromPoint(doc: Document, x: number, y: number): Element | null {
  let el = doc.elementFromPoint?.(x, y) ?? null;
  const visited = new Set<ShadowRoot>();
  while (el && el.shadowRoot && !visited.has(el.shadowRoot)) {
    visited.add(el.shadowRoot);
    const inner = el.shadowRoot.elementFromPoint?.(x, y) ?? null;
    if (!inner || inner === el) break;
    el = inner;
  }
  return el;
}

/** Resolve an inspected HTMLElement to its nearest fillable control node & captured fingerprint. */
export function inspectDomTarget(target: Element): InspectorTargetInfo | null {
  if (!(target instanceof HTMLElement)) return null;
  if (target.closest('raf-fab')) return null;

  let candidate: Element | null = target.matches(FIELD_SELECTOR) ? target : target.closest(FIELD_SELECTOR);
  if (!candidate && target.shadowRoot) {
    candidate = target.shadowRoot.querySelector(FIELD_SELECTOR);
  }
  if (!(candidate instanceof HTMLElement)) return null;

  const tag = candidate.tagName.toLowerCase();
  const kind: Control['kind'] =
    candidate instanceof HTMLTextAreaElement
      ? 'textarea'
      : candidate instanceof HTMLSelectElement
        ? 'select'
        : candidate instanceof HTMLInputElement && candidate.type === 'checkbox'
          ? 'checkbox'
          : candidate instanceof HTMLInputElement && candidate.type === 'radio'
            ? 'radio'
            : 'text';

  const control: Control = {
    id: candidate.id || 'inspected',
    el: candidate,
    kind,
    lib: 'native',
    ...(candidate instanceof HTMLInputElement ? { inputType: candidate.type || 'text' } : {}),
  };

  const evidence = collectEvidence(control);
  const [cls] = classifyAll([
    { control, evidence, sectionTitle: null, sectionRoot: null, group: null, required: false },
  ]);
  const fingerprint = captureFieldFingerprint(control, evidence);
  const r = candidate.getBoundingClientRect();

  return {
    rect: {
      left: Math.round(r.left),
      top: Math.round(r.top),
      width: Math.max(0, Math.round(r.width)),
      height: Math.max(0, Math.round(r.height)),
    },
    label: evidence[0]?.text || candidate.getAttribute('name') || candidate.id || tag,
    fieldKey: cls?.fieldKey ?? null,
    section: cls?.section ?? null,
    confidence: Number((cls?.confidence ?? 0).toFixed(3)),
    tag,
    fingerprint,
  };
}

export function createFieldInspector(opts: {
  doc: Document;
  onHover?: (target: InspectorTargetInfo | null) => void;
  onPick: (target: InspectorTargetInfo) => void;
}): InspectorController {
  let running = false;

  const targetOfEvent = (event: MouseEvent): InspectorTargetInfo | null => {
    const raw =
      typeof event.composedPath === 'function'
        ? (event.composedPath().find((n): n is Element => n instanceof Element) ?? (event.target as Element | null))
        : (event.target as Element | null);
    if (raw) {
      const hit = inspectDomTarget(raw);
      if (hit) return hit;
    }
    const atPoint = deepElementFromPoint(opts.doc, event.clientX, event.clientY);
    return atPoint ? inspectDomTarget(atPoint) : null;
  };

  const onMove = (event: MouseEvent) => {
    if (!running) return;
    opts.onHover?.(targetOfEvent(event));
  };

  const onClick = (event: MouseEvent) => {
    if (!running) return;
    const picked = targetOfEvent(event);
    if (!picked) return;
    event.preventDefault();
    event.stopPropagation();
    stop();
    opts.onPick(picked);
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if (running && event.key === 'Escape') {
      event.preventDefault();
      stop();
    }
  };

  function start() {
    if (running) return;
    running = true;
    opts.doc.addEventListener('mousemove', onMove, true);
    opts.doc.addEventListener('click', onClick, true);
    opts.doc.addEventListener('keydown', onKeyDown, true);
  }

  function stop() {
    if (!running) return;
    running = false;
    opts.doc.removeEventListener('mousemove', onMove, true);
    opts.doc.removeEventListener('click', onClick, true);
    opts.doc.removeEventListener('keydown', onKeyDown, true);
    opts.onHover?.(null);
  }

  return {
    active: () => running,
    start,
    stop,
  };
}
