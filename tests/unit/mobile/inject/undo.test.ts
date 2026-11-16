import { afterEach, describe, expect, it } from 'vitest';
import type { FieldReport } from '../../../../src/engine/types';
import { addedCards, createUndoJournal } from '../../../../mobile/inject/undo';

const setValue = (el: HTMLInputElement | HTMLTextAreaElement, v: string) => {
  el.value = v;
  el.dispatchEvent(new Event('input', { bubbles: true }));
};
const row = (fieldId: string, outcome: FieldReport['outcome'] = 'filled'): FieldReport => ({
  fieldId, label: fieldId, fieldKey: null, section: null, outcome, confidence: 1, value: 'x',
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('undo journal', () => {
  it('restores text, textarea, select, checkbox and radio through the prototype setters, with input and change', () => {
    document.body.innerHTML = `
      <input id="name" value="">
      <textarea id="about"></textarea>
      <select id="degree"><option value="">请选择</option><option value="b">本科</option></select>
      <input id="agree" type="checkbox">
      <input id="m" type="radio" name="g" value="m"><input id="f" type="radio" name="g" value="f" checked>`;
    const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
    const name = $<HTMLInputElement>('name');
    // A React-style value tracker on the instance: writes through it are what React would *not* notice.
    let tracked = '';
    const proto = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!;
    Object.defineProperty(name, 'value', {
      configurable: true,
      get() {
        return proto.get!.call(this);
      },
      set(v: string) {
        tracked = v;
        proto.set!.call(this, v);
      },
    });

    const journal = createUndoJournal(document);
    journal.snapshot();
    setValue(name, '张三');
    setValue($<HTMLTextAreaElement>('about'), '自我评价');
    $<HTMLSelectElement>('degree').selectedIndex = 1;
    $<HTMLInputElement>('agree').checked = true;
    $<HTMLInputElement>('m').checked = true;
    const controls = new Map(['name', 'about', 'degree', 'agree', 'm', 'f'].map((id) => [`c-${id}`, { el: $(id) }]));
    journal.afterFill(controls, [...controls.keys()].map((id) => row(id)));

    const events: string[] = [];
    document.body.addEventListener('input', (e) => events.push(`input:${(e.target as HTMLElement).id}`));
    document.body.addEventListener('change', (e) => events.push(`change:${(e.target as HTMLElement).id}`));
    const result = journal.restore();

    expect(name.value).toBe('');
    expect(tracked).toBe('张三'); // the tracker still holds the filled value, so a framework sees the change
    expect($<HTMLTextAreaElement>('about').value).toBe('');
    expect($<HTMLSelectElement>('degree').selectedIndex).toBe(0);
    expect($<HTMLInputElement>('agree').checked).toBe(false);
    expect($<HTMLInputElement>('m').checked).toBe(false);
    expect($<HTMLInputElement>('f').checked).toBe(true);
    expect(result.restored.sort()).toEqual(['c-about', 'c-agree', 'c-degree', 'c-f', 'c-m', 'c-name']);
    expect(result.manual).toEqual([]);
    expect(events).toContain('input:name');
    expect(events).toContain('change:name');
    expect(events).toContain('change:degree');
  });

  it('an element removed after the fill is reported manual', () => {
    document.body.innerHTML = '<input id="a"><input id="b">';
    const a = document.getElementById('a') as HTMLInputElement;
    const b = document.getElementById('b') as HTMLInputElement;
    const journal = createUndoJournal(document);
    journal.snapshot();
    setValue(a, '1');
    setValue(b, '2');
    journal.afterFill(new Map([['ca', { el: a }], ['cb', { el: b }]]), [row('ca'), row('cb')]);
    b.remove();
    expect(journal.restore()).toEqual({ restored: ['ca'], manual: ['cb'] });
  });

  it('a filled row whose control is a div widget is reported manual', () => {
    document.body.innerHTML = '<div id="w" role="combobox">本科</div>';
    const journal = createUndoJournal(document);
    journal.snapshot();
    journal.afterFill(new Map([['cw', { el: document.getElementById('w')! }]]), [row('cw'), row('cx', 'no_data')]);
    expect(journal.restore()).toEqual({ restored: [], manual: ['cw'] });
  });

  it('a field inside an open shadow root is restored too', () => {
    const host = document.createElement('div');
    document.body.append(host);
    const root = host.attachShadow({ mode: 'open' });
    root.innerHTML = '<input id="s">';
    const input = root.getElementById('s') as HTMLInputElement;
    const journal = createUndoJournal(document);
    journal.snapshot();
    setValue(input, 'x');
    journal.afterFill(new Map([['cs', { el: input }]]), [row('cs')]);
    expect(journal.restore().restored).toEqual(['cs']);
    expect(input.value).toBe('');
  });

  it('addedCards sums growth.added', () => {
    expect(
      addedCards([
        { section: 'education', have: 2, need: 2, added: 1, status: 'ok' },
        { section: 'work', have: 3, need: 3, added: 2, status: 'ok' },
      ] as never),
    ).toBe(3);
    expect(addedCards([])).toBe(0);
  });
});
