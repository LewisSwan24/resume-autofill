import { afterEach, describe, expect, it } from 'vitest';
import {
  fireBlur,
  fireChange,
  fireInput,
  focusElement,
  pressKey,
  setNativeValue,
  simulateClick,
  typeText,
  winOf,
} from '../../../src/drivers/events';
import { mount, record } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

describe('setNativeValue', () => {
  it('uses the prototype setter, bypassing an instance-level value override (React tracker)', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    let hijacked = 0;
    Object.defineProperty(input, 'value', {
      configurable: true,
      get: () => 'tracked',
      set: () => {
        hijacked++;
      },
    });
    setNativeValue(input, 'hello');
    expect(hijacked).toBe(0);
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    expect(proto.get!.call(input)).toBe('hello');
  });

  it('picks the textarea prototype for textareas and select prototype for selects', () => {
    const ta = document.createElement('textarea');
    setNativeValue(ta, 'multi\nline');
    expect(ta.value).toBe('multi\nline');
    const sel = document.createElement('select');
    sel.innerHTML = '<option value="a">A</option><option value="b">B</option>';
    setNativeValue(sel, 'b');
    expect(sel.value).toBe('b');
  });
});

describe('realm correctness', () => {
  it('builds events and setters from the iframe window for iframe elements', () => {
    const frame = document.createElement('iframe');
    document.body.appendChild(frame);
    const fdoc = frame.contentDocument!;
    const fwin = frame.contentWindow as Window & typeof globalThis;
    const input = fdoc.createElement('input');
    fdoc.body.appendChild(input);
    expect(winOf(input)).toBe(fwin);
    expect(winOf(input)).not.toBe(window);

    let seen: Event | null = null;
    input.addEventListener('input', (e) => (seen = e));
    setNativeValue(input, 'x');
    fireInput(input, 'x');
    expect(input.value).toBe('x');
    expect(seen).toBeInstanceOf(fwin.InputEvent);
    expect(seen).not.toBeInstanceOf(window.InputEvent);

    let click: Event | null = null;
    input.addEventListener('click', (e) => (click = e));
    simulateClick(input);
    expect(click).toBeInstanceOf(fwin.MouseEvent);
  });
});

describe('simple events', () => {
  it('fireInput / fireChange bubble and are composed; input carries data', () => {
    const host = mount('<input id="a">');
    const input = host.querySelector('input')!;
    const seen: Event[] = [];
    document.addEventListener('input', (e) => seen.push(e));
    document.addEventListener('change', (e) => seen.push(e));
    fireInput(input, 'hi');
    fireChange(input);
    expect(seen.map((e) => e.type)).toEqual(['input', 'change']);
    expect(seen.every((e) => e.bubbles && e.composed)).toBe(true);
    expect((seen[0] as InputEvent).data).toBe('hi');
    expect((seen[0] as InputEvent).inputType).toBe('insertText');
  });

  it('focusElement / fireBlur produce focus + blur events exactly once', () => {
    const host = mount('<input id="a">');
    const input = host.querySelector('input')!;
    const log = record(input, ['focus', 'focusin', 'blur', 'focusout']);
    focusElement(input);
    expect(document.activeElement).toBe(input);
    fireBlur(input);
    expect(log.filter((t) => t === 'focus')).toHaveLength(1);
    expect(log.filter((t) => t === 'blur')).toHaveLength(1);
    expect(log).toContain('focusout');
  });

  it('fireBlur synthesizes blur + focusout for an element that never had focus', () => {
    const host = mount('<input id="a">');
    const input = host.querySelector('input')!;
    const log = record(input, ['blur', 'focusout']);
    fireBlur(input);
    expect(log).toEqual(['blur', 'focusout']);
  });
});

describe('simulateClick', () => {
  it('dispatches the full pointer sequence at the element centre with button 0', () => {
    const host = mount('<div id="t"></div>');
    const el = host.querySelector('#t') as HTMLElement;
    el.getBoundingClientRect = () => ({ left: 10, top: 20, width: 100, height: 40, right: 110, bottom: 60, x: 10, y: 20, toJSON() {} });
    const seen: MouseEvent[] = [];
    for (const t of ['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']) {
      el.addEventListener(t, (e) => seen.push(e as MouseEvent));
    }
    simulateClick(el);
    expect(seen.map((e) => e.type)).toEqual(['pointerdown', 'mousedown', 'pointerup', 'mouseup', 'click']);
    for (const e of seen) {
      expect(e.button).toBe(0);
      expect(e.clientX).toBe(60);
      expect(e.clientY).toBe(40);
      expect(e.bubbles).toBe(true);
    }
    expect(seen[1]!.buttons).toBe(1);
    expect(seen[4]!.buttons).toBe(0);
  });

  it('activates a checkbox (real click semantics)', () => {
    const host = mount('<input type="checkbox">');
    const cb = host.querySelector('input')!;
    simulateClick(cb);
    expect(cb.checked).toBe(true);
  });
});

describe('typeText / pressKey', () => {
  it('types per character with keydown, beforeinput, input and keyup', () => {
    const host = mount('<input id="a" value="old">');
    const input = host.querySelector('input')!;
    const log = record(input, ['keydown', 'beforeinput', 'input', 'keyup']);
    typeText(input, 'ab');
    expect(input.value).toBe('ab');
    // first `input` is the clearing of "old"
    expect(log).toEqual([
      'input',
      'keydown', 'beforeinput', 'input', 'keyup',
      'keydown', 'beforeinput', 'input', 'keyup',
    ]);
  });

  it('honours a cancelled beforeinput', () => {
    const host = mount('<input id="a">');
    const input = host.querySelector('input')!;
    input.addEventListener('beforeinput', (e) => e.preventDefault());
    typeText(input, 'zz');
    expect(input.value).toBe('');
  });

  it('pressKey sends keydown/keyup with key, code and keyCode; returns false when handled', () => {
    const host = mount('<input id="a">');
    const input = host.querySelector('input')!;
    const seen: KeyboardEvent[] = [];
    input.addEventListener('keydown', (e) => {
      seen.push(e);
      e.preventDefault();
    });
    input.addEventListener('keyup', (e) => seen.push(e));
    expect(pressKey(input, 'Enter')).toBe(false);
    expect(seen.map((e) => e.type)).toEqual(['keydown', 'keyup']);
    expect(seen[0]!.key).toBe('Enter');
    expect(seen[0]!.code).toBe('Enter');
    expect(seen[0]!.keyCode).toBe(13);
  });
});
