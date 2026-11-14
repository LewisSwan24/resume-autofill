// Undo of one fill in one frame. The engine has no undo, so the page entry snapshots every native control
// before a fill and puts back the ones the fill changed, through the prototype setters (so frameworks that track
// values, like React, notice) plus input/change events. Custom widgets, uploads and added cards cannot be put back:
// they are listed for the person to fix by hand.
import type { SectionGrowth } from '../../src/fill/ensureCards';
import type { FieldReport } from '../../src/engine/types';

export interface UndoJournal {
  /** Before the fill. */
  snapshot(): void;
  /** After the fill: which recorded controls each report field changed. */
  afterFill(controls: ReadonlyMap<string, { el: HTMLElement }>, fields?: readonly FieldReport[]): void;
  /** Field ids put back, and filled field ids that could not be. */
  restore(): { restored: string[]; manual: string[] };
}

type Native = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
interface ControlState {
  value: string;
  checked: boolean;
  selectedIndex: number;
  selected: boolean[] | null;
  files: number;
}

const SKIPPED_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image']);

/** Native controls in the document, light DOM and open shadow roots. */
function nativeControls(root: Document | ShadowRoot | Element, out: Native[] = []): Native[] {
  for (const el of root.querySelectorAll('input, textarea, select')) {
    if (el instanceof Element && el.tagName === 'INPUT' && SKIPPED_TYPES.has((el as HTMLInputElement).type)) continue;
    out.push(el as Native);
  }
  for (const el of root.querySelectorAll('*')) if (el.shadowRoot) nativeControls(el.shadowRoot, out);
  return out;
}

function read(el: Native): ControlState {
  const isInput = el.tagName === 'INPUT';
  const input = el as HTMLInputElement;
  const select = el.tagName === 'SELECT' ? (el as HTMLSelectElement) : null;
  return {
    value: el.value,
    checked: isInput ? input.checked : false,
    selectedIndex: select ? select.selectedIndex : -1,
    selected: select?.multiple ? [...select.options].map((o) => o.selected) : null,
    files: isInput && input.type === 'file' ? (input.files?.length ?? 0) : 0,
  };
}

const isToggle = (el: Native) => el.tagName === 'INPUT' && ((el as HTMLInputElement).type === 'checkbox' || (el as HTMLInputElement).type === 'radio');
const isFile = (el: Native) => el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'file';

function differs(el: Native, a: ControlState, b: ControlState): boolean {
  if (isToggle(el)) return a.checked !== b.checked;
  if (isFile(el)) return a.files !== b.files;
  if (a.selected && b.selected) return a.selected.some((s, i) => s !== b.selected![i]);
  return a.value !== b.value || a.selectedIndex !== b.selectedIndex;
}

function setter(win: Window & typeof globalThis, el: Native, prop: string): ((v: unknown) => void) | null {
  const proto =
    el.tagName === 'INPUT' ? win.HTMLInputElement.prototype : el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype : win.HTMLSelectElement.prototype;
  const set = Object.getOwnPropertyDescriptor(proto, prop)?.set;
  return set ? (v) => set.call(el, v) : null;
}

function fire(el: Element): void {
  el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
  el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
}

/** Put one control back; false when that is not possible. */
function put(el: Native, old: ControlState): boolean {
  const win = el.ownerDocument.defaultView as (Window & typeof globalThis) | null;
  if (!win || !el.isConnected) return false;
  try {
    if (isToggle(el)) {
      setter(win, el, 'checked')?.(old.checked);
    } else if (isFile(el)) {
      if (old.files !== 0 || typeof win.DataTransfer !== 'function') return false;
      (el as HTMLInputElement).files = new win.DataTransfer().files;
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      return true;
    } else if (old.selected && el.tagName === 'SELECT') {
      const optionSet = Object.getOwnPropertyDescriptor(win.HTMLOptionElement.prototype, 'selected')?.set;
      [...(el as HTMLSelectElement).options].forEach((o, i) => optionSet?.call(o, old.selected![i] ?? false));
    } else if (el.tagName === 'SELECT') {
      setter(win, el, 'selectedIndex')?.(old.selectedIndex);
    } else {
      const set = setter(win, el, 'value');
      if (!set) return false;
      set(old.value);
    }
    fire(el);
    return true;
  } catch {
    return false;
  }
}

export function createUndoJournal(doc: Document): UndoJournal {
  let before = new Map<Native, ControlState>();
  /** field id → its changed controls */
  let changed = new Map<string, Native[]>();
  /** fields whose control holds at least one recorded native control */
  let withNative = new Set<string>();
  /** field ids that count as manual when not restored */
  let filled: string[] = [];

  return {
    snapshot() {
      before = new Map(nativeControls(doc).map((el) => [el, read(el)]));
      changed = new Map();
      withNative = new Set();
      filled = [];
    },

    afterFill(controls, fields = []) {
      changed = new Map();
      withNative = new Set();
      for (const [fieldId, { el }] of controls) {
        const mine: Native[] = [];
        for (const [native, old] of before) {
          if (native !== el && !el.contains(native)) continue;
          withNative.add(fieldId);
          if (native.isConnected && differs(native, old, read(native))) mine.push(native);
        }
        changed.set(fieldId, mine);
      }
      filled = fields.filter((f) => f.outcome === 'filled' || (f.outcome === 'needs_review' && !!f.value)).map((f) => f.fieldId);
    },

    restore() {
      const restored = new Set<string>();
      const failed = new Set<string>();
      // Unchecking first, so a radio group ends on its old choice.
      const jobs = [...changed].flatMap(([fieldId, els]) => els.map((el) => ({ fieldId, el, old: before.get(el)! })));
      jobs.sort((a, b) => Number(a.old.checked) - Number(b.old.checked));
      for (const { fieldId, el, old } of jobs) {
        if (put(el, old)) restored.add(fieldId);
        else failed.add(fieldId);
      }
      // Not restored and either failed, or never a native control (custom widget, gone before the fill ended).
      const manual = filled.filter((id) => !restored.has(id) && (failed.has(id) || !withNative.has(id)));
      changed = new Map();
      return { restored: [...restored], manual };
    },
  };
}

/** Cards the fill added (undo does not remove them). */
export function addedCards(growth: readonly SectionGrowth[]): number {
  return growth.reduce((sum, g) => sum + (g.added > 0 ? g.added : 0), 0);
}
