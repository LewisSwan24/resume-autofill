import { afterEach, describe, expect, it } from 'vitest';
import { MAX_VIRTUAL_SCROLL_STEPS, scrollVirtualDropdown } from '../../../src/drivers/virtualScroll';
import { byLabel, mount } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
});

function setupVirtualList(totalItems: number, windowSize = 5) {
  const popup = mount(`
    <div id="popup">
      <div class="rc-virtual-list-holder" style="height: 150px; overflow: auto;">
        <div class="items"></div>
      </div>
    </div>
  `) as HTMLElement;
  const holder = popup.querySelector<HTMLElement>('.rc-virtual-list-holder')!;
  const itemsHost = popup.querySelector<HTMLElement>('.items')!;

  let scrollPos = 0;
  Object.defineProperty(holder, 'clientHeight', { value: 150, configurable: true });
  Object.defineProperty(holder, 'scrollHeight', { value: totalItems * 30, configurable: true });
  Object.defineProperty(holder, 'scrollTop', {
    get: () => scrollPos,
    set: (v: number) => {
      scrollPos = Math.max(0, Math.min(v, Math.max(0, totalItems * 30 - 150)));
    },
    configurable: true,
  });

  const renderWindow = (startIdx: number) => {
    const end = Math.min(totalItems, startIdx + windowSize);
    itemsHost.innerHTML = '';
    for (let i = startIdx; i < end; i++) {
      const div = document.createElement('div');
      div.className = 'opt';
      div.textContent = `Option ${i}`;
      itemsHost.appendChild(div);
    }
  };

  renderWindow(0);
  holder.addEventListener('scroll', () => {
    const startIdx = Math.floor(scrollPos / 30);
    renderWindow(startIdx);
  });

  return { popup: popup.querySelector<HTMLElement>('#popup') ?? popup, holder };
}

describe('scrollVirtualDropdown', () => {
  it('returns immediately when the target option is already in the first viewport', async () => {
    const { popup } = setupVirtualList(40);
    const res = await scrollVirtualDropdown(popup, byLabel('Option 2'), {
      optionSelector: '.opt',
      settleMs: 10,
    });
    expect(res.stepsUsed).toBe(0);
    expect(res.stoppedByFixedPoint).toBe(false);
    expect(res.options.some((o) => o.info.label === 'Option 2')).toBe(true);
  });

  it('scrolls step by step until a later virtualized option enters the DOM', async () => {
    const { popup } = setupVirtualList(30);
    const res = await scrollVirtualDropdown(popup, byLabel('Option 14'), {
      optionSelector: '.opt',
      settleMs: 10,
    });
    expect(res.stepsUsed).toBeGreaterThan(0);
    expect(res.stoppedByFixedPoint).toBe(false);
    expect(res.options.some((o) => o.info.label === 'Option 14')).toBe(true);
  });

  it('stops cleanly via fixed-point detection when scroll position and options do not advance', async () => {
    const host = mount(`
      <div id="frozen-popup">
        <div class="el-select-dropdown__wrap">
          <div class="opt">Static A</div>
        </div>
      </div>
    `);
    const popup = host.querySelector<HTMLElement>('#frozen-popup')!;
    const holder = popup.querySelector<HTMLElement>('.el-select-dropdown__wrap')!;
    Object.defineProperty(holder, 'clientHeight', { value: 120, configurable: true });
    Object.defineProperty(holder, 'scrollHeight', { value: 600, configurable: true });
    Object.defineProperty(holder, 'scrollTop', { get: () => 0, set: () => {}, configurable: true });

    const res = await scrollVirtualDropdown(popup, byLabel('Missing'), {
      optionSelector: '.opt',
      settleMs: 10,
    });
    expect(res.stoppedByFixedPoint).toBe(true);
    expect(res.stepsUsed).toBeLessThan(MAX_VIRTUAL_SCROLL_STEPS);
  });

  it('enforces the MAX_VIRTUAL_SCROLL_STEPS (25) ceiling even on huge virtual lists', async () => {
    const { popup } = setupVirtualList(500);
    const res = await scrollVirtualDropdown(popup, byLabel('Option 499'), {
      optionSelector: '.opt',
      settleMs: 5,
    });
    expect(res.stepsUsed).toBe(MAX_VIRTUAL_SCROLL_STEPS);
    expect(res.options.length).toBeGreaterThan(20);
  });
});
