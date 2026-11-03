import { afterEach, describe, expect, it } from 'vitest';
import { closeDropdown, findDropdownNear, visibleOptions } from '../../../src/drivers/dropdown';
import { mount, record } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

function place(el: Element, left: number, top: number, width = 100, height = 20): void {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({ left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON() {} }) as DOMRect;
}

describe('findDropdownNear', () => {
  it('chooses the panel nearest to the trigger bottom-left', () => {
    const host = mount(`
      <div id="trigger"></div>
      <div class="dd" id="far"></div>
      <div class="dd" id="near"></div>
      <div class="dd" id="mid"></div>`);
    place(host.querySelector('#trigger')!, 100, 100, 200, 30); // bottom-left = (100, 130)
    place(host.querySelector('#far')!, 600, 500);
    place(host.querySelector('#near')!, 102, 134);
    place(host.querySelector('#mid')!, 160, 200);
    expect(findDropdownNear(host.querySelector('#trigger')!, '.dd')?.id).toBe('near');
  });

  it('ignores *-hidden, aria-hidden, display:none and leave-animation panels', () => {
    const host = mount(`
      <div id="trigger"></div>
      <div class="dd ant-select-dropdown-hidden" id="hidden"></div>
      <div class="dd" aria-hidden="true" id="aria"></div>
      <div class="dd" style="display:none" id="none"></div>
      <div class="fade-leave-active"><div class="dd" id="leaving"></div></div>
      <div class="el-zoom-in-top-leave-to"><div class="dd" id="leaving2"></div></div>
      <div class="dd" id="live"></div>`);
    place(host.querySelector('#trigger')!, 0, 0);
    // The ignored panels are the closest ones, so only the filters can exclude them.
    for (const id of ['hidden', 'aria', 'none', 'leaving', 'leaving2']) place(host.querySelector('#' + id)!, 0, 20);
    place(host.querySelector('#live')!, 400, 400);
    expect(findDropdownNear(host.querySelector('#trigger')!, '.dd')?.id).toBe('live');
  });

  it('returns null when nothing qualifies, and prefers the later panel on a tie', () => {
    const host = mount('<div id="trigger"></div><div class="dd" id="a"></div><div class="dd" id="b"></div>');
    const trigger = host.querySelector('#trigger')!;
    expect(findDropdownNear(trigger, '.missing')).toBeNull();
    expect(findDropdownNear(trigger, '.dd')?.id).toBe('b');
  });
});

describe('visibleOptions', () => {
  it('lists enabled visible options with trimmed labels and data-value', () => {
    const host = mount(`
      <ul id="dd">
        <li class="opt" data-value="m">  Master
          degree </li>
        <li class="opt is-disabled">Disabled</li>
        <li class="opt ant-select-item-option-disabled">Disabled 2</li>
        <li class="opt" aria-disabled="true">Disabled 3</li>
        <li class="opt" style="display:none">Hidden</li>
        <li class="opt">PhD</li>
      </ul>`);
    const opts = visibleOptions(host.querySelector('#dd')!, '.opt');
    expect(opts.map((o) => o.info)).toEqual([{ label: 'Master degree', value: 'm' }, { label: 'PhD' }]);
    expect(opts[0]!.el.tagName).toBe('LI');
  });
});

describe('closeDropdown', () => {
  it('presses Escape on the active element and blurs it, without any mouse events', () => {
    const host = mount('<input id="a"><button id="elsewhere"></button>');
    const input = host.querySelector('input')!;
    input.focus();
    const keys = record(input, ['keydown', 'keyup', 'blur']);
    const mouse = record(document.body, ['mousedown', 'mouseup', 'click']);
    closeDropdown(document);
    expect(keys).toContain('keydown');
    expect(keys).toContain('blur');
    expect(mouse).toEqual([]);
  });
});
