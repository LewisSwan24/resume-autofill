// How far up a label can be is up to the page. What ends the look is the box's own block ending.
import { afterEach, describe, expect, it } from 'vitest';
import { countBoxes, looksUnderRead } from '../../../entrypoints/fab.content/summarize';
import { scanDocument } from '../../../src/engine/scan';

afterEach(() => {
  document.body.replaceChildren();
});

function show(html: string): void {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  document.body.replaceChildren(...Array.from(doc.body.childNodes).map((n) => document.adoptNode(n)));
}

function keyOf(id: string): string | null {
  const { contexts, classifications } = scanDocument(document);
  const i = contexts.findIndex((c) => c.control.el.id === id);
  return i < 0 ? null : classifications[i]!.fieldKey;
}

/** The box, wrapped this many times over. */
const deep = (inner: string, levels: number): string => (levels === 0 ? inner : `<div class="w">${deep(inner, levels - 1)}</div>`);
const row = (label: string, id: string, levels: number) => `<div class="row"><div class="t"><span>${label}</span></div>${deep(`<input id="${id}" type="text">`, levels)}</div>`;

describe('a box that has its own name', () => {
  it('does not take a word from far above it instead', () => {
    show(deep(`<div>Phone</div>${deep('<input id="a" type="text" aria-label="Favourite colour">', 7)}`, 1));
    expect(keyOf('a')).not.toBe('contact.phone');
  });
});

describe('a label as far up as the block goes', () => {
  it.each([1, 4, 5, 7, 9, 11])('%i levels of wrapping', (levels) => {
    show(`<form>${row('邮箱', 'a', levels)}${row('姓名', 'b', levels)}</form>`);
    expect(keyOf('a')).toBe('contact.email');
    expect(keyOf('b')).toBe('basics.fullName');
  });

  it('with nothing around it on the page but its own form', () => {
    show(`<form>${row('手机号码', 'a', 7)}</form>`);
    expect(keyOf('a')).toBe('contact.phone');
  });
});

describe('and no further', () => {
  it('another field’s label is not borrowed', () => {
    show(`<form>${row('邮箱', 'a', 7)}<div class="row">${deep('<input id="b" type="text">', 7)}</div></form>`);
    expect(keyOf('a')).toBe('contact.email');
    expect(keyOf('b')).toBeNull();
  });

  it('words above a heading belong to what came before it', () => {
    show(`<form><div>邮箱</div><h2>其他</h2>${deep('<input id="a" type="text">', 7)}</form>`);
    expect(keyOf('a')).toBeNull();
  });

  it('words outside its own section are someone else’s', () => {
    show(`<div>邮箱</div><section>${deep('<input id="a" type="text">', 7)}</section>`);
    expect(keyOf('a')).toBeNull();
  });

  it('words outside the form are not about the form', () => {
    show(`<div>邮箱</div><form>${deep('<input id="a" type="text">', 7)}</form>`);
    expect(keyOf('a')).toBeNull();
  });

  it('a paragraph above is not a label', () => {
    show(`<form><div>${'请认真填写邮箱和电话，'.repeat(20)}</div>${deep('<input id="a" type="text">', 7)}</form>`);
    expect(keyOf('a')).toBeNull();
  });
});

describe('saying so when a page is barely read', () => {
  it.each([
    [1, 61, true],
    [4, 19, true],
    [0, 6, true],
    [5, 19, false],
    [7, 22, false],
    [1, 5, false],
    [0, 5, false],
    [30, 40, false],
  ])('%i of %i: %s', (read, boxes, warn) => {
    expect(looksUnderRead(read, boxes)).toBe(warn);
  });

  it('counts what can be typed into or picked from, and nothing else', () => {
    show(`<form>
      <input type="text"><input><input type="email"><textarea></textarea><select></select>
      <input type="hidden"><input type="checkbox"><input type="radio"><input type="file"><input type="submit"><input type="button">
      <input type="text" disabled>
    </form>`);
    expect(countBoxes(document)).toBe(5);
  });
});
