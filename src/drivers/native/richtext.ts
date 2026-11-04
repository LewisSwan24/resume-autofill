// Native driver: contenteditable editors.
import type { Control } from '../../engine/types';
import { fireBlur, fireChange, fireInput, focusElement, makeEvent, simulateClick, winOf } from '../events';
import type { DriverContext, FillResult } from '../types';
import { failed, settle, squash, stripSpace } from './shared';

// ------------------------------------------------------------------ richtext

function selectAllContent(el: HTMLElement): void {
  const sel = winOf(el).getSelection?.();
  if (!sel) return;
  const range = el.ownerDocument.createRange();
  range.selectNodeContents(el);
  sel.removeAllRanges();
  sel.addRange(range);
}

/** Dispatch a paste carrying text/plain. Returns true when a handler cancelled it (= took over the paste). */
function dispatchPaste(el: HTMLElement, text: string): boolean {
  const win = winOf(el);
  const DT = (win as unknown as { DataTransfer?: new () => DataTransfer }).DataTransfer;
  let clipboardData: unknown = null;
  if (typeof DT === 'function') {
    try {
      const dt = new DT();
      dt.setData('text/plain', text);
      clipboardData = dt;
    } catch {
      clipboardData = null;
    }
  }
  clipboardData ??= {
    types: ['text/plain'],
    files: [],
    items: [],
    getData: (type: string) => (type === 'text/plain' || type === 'text' ? text : ''),
    setData: () => undefined,
  };
  const event = makeEvent(el, ['ClipboardEvent', 'Event'], 'paste', { clipboardData });
  if ((event as unknown as { clipboardData?: unknown }).clipboardData == null) {
    Object.defineProperty(event, 'clipboardData', { value: clipboardData });
  }
  return !el.dispatchEvent(event);
}

function execInsertText(el: HTMLElement, text: string): boolean {
  const doc = el.ownerDocument;
  if (typeof doc.execCommand !== 'function') return false;
  try {
    return doc.execCommand('insertText', false, text);
  } catch {
    return false;
  }
}

export async function fillRichtext(control: Control, text: string, ctx: DriverContext): Promise<FillResult> {
  const el = control.el;
  const present = (): boolean => stripSpace(el.textContent ?? '').includes(stripSpace(text));
  if (ctx.attempt === 2) simulateClick(el);
  focusElement(el);
  selectAllContent(el);
  // Strategy ladder: simulated paste → execCommand → direct textContent. The first two run the
  // editor's own input pipeline (Quill / Slate / ProseMirror listen to paste and beforeinput).
  if (ctx.attempt === 1) dispatchPaste(el, text);
  if (!present()) {
    selectAllContent(el);
    execInsertText(el, text);
  }
  if (!present()) {
    el.textContent = text;
    fireInput(el, text);
  }
  fireChange(el);
  fireBlur(el);
  const ok = await settle(el, ctx, present);
  const observed = squash(el.textContent);
  return ok ? { ok: true, observed } : failed('editor content did not match', observed);
}
