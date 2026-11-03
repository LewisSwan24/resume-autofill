// Realm-correct DOM event and value helpers. Everything is built from the element's OWN window
// (`el.ownerDocument.defaultView`), so it keeps working for elements inside iframes and
// the prototype setter bypasses React's instance-level value tracker.

export type Win = Window & typeof globalThis;
type AnyCtor = new (type: string, init?: Record<string, unknown>) => Event;

/** The window that owns `node` (falls back to the current global for detached nodes). */
export function winOf(node: Node): Win {
  const doc = node.nodeType === 9 ? (node as Document) : node.ownerDocument;
  return (doc?.defaultView ?? window) as Win;
}

function ctorOf(win: Win, names: string[]): AnyCtor {
  const bag = win as unknown as Record<string, unknown>;
  for (const name of names) if (typeof bag[name] === 'function') return bag[name] as AnyCtor;
  return win.Event as unknown as AnyCtor;
}

/** Build an event with the first available constructor from `names` (e.g. PointerEvent → MouseEvent → Event). */
export function makeEvent(el: Node, names: string[], type: string, init: Record<string, unknown> = {}): Event {
  const win = winOf(el);
  const Ctor = ctorOf(win, names);
  const full = { bubbles: true, cancelable: true, composed: true, ...init };
  try {
    return new Ctor(type, full);
  } catch (error) {
    // Some DOM implementations reject a `view` that is not a genuine Window (e.g. a proxied global).
    if (!('view' in full)) throw error;
    const { view: _view, ...rest } = full;
    return new Ctor(type, rest);
  }
}

// ---------------------------------------------------------------- value

export type ValueElement = HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;

/** Write `.value` through the element's own-realm prototype setter (React cannot swallow it). */
export function setNativeValue(el: ValueElement, value: string): void {
  const win = winOf(el);
  const tag = el.tagName;
  const proto =
    tag === 'TEXTAREA'
      ? win.HTMLTextAreaElement.prototype
      : tag === 'SELECT'
        ? win.HTMLSelectElement.prototype
        : win.HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (setter) setter.call(el, value);
  else el.value = value;
}

// ---------------------------------------------------------------- simple events

export function fireInput(el: Element, data: string | null = null, inputType = 'insertText'): boolean {
  return el.dispatchEvent(makeEvent(el, ['InputEvent', 'Event'], 'input', { data, inputType }));
}

export function fireChange(el: Element): boolean {
  return el.dispatchEvent(makeEvent(el, ['Event'], 'change'));
}

/** Focus the element; if the browser fires no focus event (unfocused window), dispatch synthetic ones. */
export function focusElement(el: HTMLElement): void {
  let seen = false;
  const on = (): void => {
    seen = true;
  };
  el.addEventListener('focus', on, { once: true });
  try {
    el.focus({ preventScroll: true });
  } catch {
    /* ignore */
  }
  el.removeEventListener('focus', on);
  if (seen) return;
  el.dispatchEvent(makeEvent(el, ['FocusEvent', 'Event'], 'focus', { cancelable: false }));
  el.dispatchEvent(makeEvent(el, ['FocusEvent', 'Event'], 'focusin', { cancelable: false }));
}

/** Blur the element; synthesizes blur + focusout when the browser did not fire them. */
export function fireBlur(el: HTMLElement): void {
  let seen = false;
  const on = (): void => {
    seen = true;
  };
  el.addEventListener('blur', on, { once: true });
  try {
    el.blur();
  } catch {
    /* ignore */
  }
  el.removeEventListener('blur', on);
  if (seen) return;
  el.dispatchEvent(makeEvent(el, ['FocusEvent', 'Event'], 'blur', { cancelable: false }));
  el.dispatchEvent(makeEvent(el, ['FocusEvent', 'Event'], 'focusout', { cancelable: false }));
}

// ---------------------------------------------------------------- pointer

/**
 * pointerdown → mousedown → pointerup → mouseup → click at the element centre, `button: 0`.
 * rc-select / Element Plus open on mousedown, so a bare `.click()` is not enough for them.
 * Returns false when the click event was cancelled.
 */
export function simulateClick(el: Element): boolean {
  const win = winOf(el);
  const rect = el.getBoundingClientRect();
  const pos = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
  const base = { view: win, button: 0, ...pos };
  const pointer = { pointerId: 1, pointerType: 'mouse', isPrimary: true };
  el.dispatchEvent(makeEvent(el, ['PointerEvent', 'MouseEvent'], 'pointerdown', { ...base, ...pointer, buttons: 1 }));
  el.dispatchEvent(makeEvent(el, ['MouseEvent'], 'mousedown', { ...base, buttons: 1, detail: 1 }));
  el.dispatchEvent(makeEvent(el, ['PointerEvent', 'MouseEvent'], 'pointerup', { ...base, ...pointer, buttons: 0 }));
  el.dispatchEvent(makeEvent(el, ['MouseEvent'], 'mouseup', { ...base, buttons: 0, detail: 1 }));
  return el.dispatchEvent(makeEvent(el, ['MouseEvent'], 'click', { ...base, buttons: 0, detail: 1 }));
}

// ---------------------------------------------------------------- keyboard

const KEYS: Record<string, { code: string; keyCode: number }> = {
  Enter: { code: 'Enter', keyCode: 13 },
  Escape: { code: 'Escape', keyCode: 27 },
  Tab: { code: 'Tab', keyCode: 9 },
  Backspace: { code: 'Backspace', keyCode: 8 },
  Delete: { code: 'Delete', keyCode: 46 },
  ' ': { code: 'Space', keyCode: 32 },
  ArrowUp: { code: 'ArrowUp', keyCode: 38 },
  ArrowDown: { code: 'ArrowDown', keyCode: 40 },
  ArrowLeft: { code: 'ArrowLeft', keyCode: 37 },
  ArrowRight: { code: 'ArrowRight', keyCode: 39 },
  Home: { code: 'Home', keyCode: 36 },
  End: { code: 'End', keyCode: 35 },
};

function keyInit(key: string): Record<string, unknown> {
  const known = KEYS[key];
  if (known) return { key, code: known.code, keyCode: known.keyCode, which: known.keyCode };
  const upper = key.toUpperCase();
  const keyCode = key.length === 1 && /[A-Z0-9]/.test(upper) ? upper.charCodeAt(0) : 0;
  const code = /^[a-z]$/i.test(key) ? `Key${upper}` : /^[0-9]$/.test(key) ? `Digit${key}` : '';
  return { key, code, keyCode, which: keyCode };
}

/** keydown + keyup for one key. Returns false when keydown was cancelled (the widget handled it). */
export function pressKey(el: Element, key: string): boolean {
  const init = keyInit(key);
  const proceed = el.dispatchEvent(makeEvent(el, ['KeyboardEvent'], 'keydown', init));
  el.dispatchEvent(makeEvent(el, ['KeyboardEvent'], 'keyup', init));
  return proceed;
}

/**
 * Per-character typing: keydown → beforeinput → value setter → input → keyup.
 * Retry strategy for inputs that ignore a single bulk write. Clears existing content first.
 */
export function typeText(el: HTMLInputElement | HTMLTextAreaElement, text: string): void {
  if (el.value !== '') {
    setNativeValue(el, '');
    fireInput(el, null, 'deleteContentBackward');
  }
  for (const ch of Array.from(text)) {
    const init = keyInit(ch);
    el.dispatchEvent(makeEvent(el, ['KeyboardEvent'], 'keydown', init));
    const allowed = el.dispatchEvent(
      makeEvent(el, ['InputEvent', 'Event'], 'beforeinput', { data: ch, inputType: 'insertText' }),
    );
    if (allowed) {
      setNativeValue(el, el.value + ch);
      fireInput(el, ch);
    }
    el.dispatchEvent(makeEvent(el, ['KeyboardEvent'], 'keyup', init));
  }
}
