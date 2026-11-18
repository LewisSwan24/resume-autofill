import { afterEach, describe, expect, it, vi } from 'vitest';
import { createFieldInspector, deepElementFromPoint, inspectDomTarget } from '../../../src/content/inspector';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('content/inspector', () => {
  it('drills through nested open ShadowRoots with deepElementFromPoint', () => {
    const outer = document.createElement('div');
    const outerShadow = outer.attachShadow({ mode: 'open' });
    const inner = document.createElement('div');
    const innerShadow = inner.attachShadow({ mode: 'open' });
    const input = document.createElement('input');
    input.name = 'github';
    innerShadow.appendChild(input);
    outerShadow.appendChild(inner);
    document.body.appendChild(outer);

    document.elementFromPoint = vi.fn().mockReturnValue(outer);
    outerShadow.elementFromPoint = vi.fn().mockReturnValue(inner);
    innerShadow.elementFromPoint = vi.fn().mockReturnValue(input);

    expect(deepElementFromPoint(document, 12, 34)).toBe(input);
  });

  it('captures field metadata & fingerprint without touching host styles or ignoring raf-fab', () => {
    const fab = document.createElement('raf-fab');
    const fabChild = document.createElement('button');
    fab.appendChild(fabChild);
    document.body.appendChild(fab);
    expect(inspectDomTarget(fabChild)).toBeNull();

    const wrapper = document.createElement('div');
    const label = document.createElement('label');
    label.setAttribute('for', 'gh');
    label.textContent = 'GitHub Profile';
    const input = document.createElement('input');
    input.id = 'gh';
    input.name = 'github';
    input.getBoundingClientRect = () =>
      ({ left: 10, top: 20, width: 220, height: 32, right: 230, bottom: 52, x: 10, y: 20, toJSON() {} }) as DOMRect;
    wrapper.append(label, input);
    document.body.appendChild(wrapper);

    const beforeStyle = input.getAttribute('style');
    const info = inspectDomTarget(input);
    expect(info).not.toBeNull();
    expect(info!.fieldKey).toBeTruthy();
    expect(info!.rect).toEqual({ left: 10, top: 20, width: 220, height: 32 });
    expect(info!.fingerprint.nameAttr).toBe('github');
    expect(info!.fingerprint.labelTokens.length).toBeGreaterThan(0);
    expect(input.getAttribute('style')).toBe(beforeStyle);
  });

  it('handles hover, pick, Escape stop, and never uses window.postMessage', () => {
    const postSpy = vi.spyOn(window, 'postMessage');
    const label = document.createElement('label');
    label.setAttribute('for', 'email');
    label.textContent = '邮箱';
    const input = document.createElement('input');
    input.id = 'email';
    input.name = 'email';
    document.body.append(label, input);

    const hovered: unknown[] = [];
    const picked: unknown[] = [];
    const inspector = createFieldInspector({
      doc: document,
      onHover: (t) => hovered.push(t),
      onPick: (t) => picked.push(t),
    });

    inspector.start();
    expect(inspector.active()).toBe(true);

    input.dispatchEvent(new MouseEvent('mousemove', { bubbles: true }));
    expect(hovered.at(-1)).toMatchObject({ fieldKey: 'contact.email' });

    input.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    expect(picked).toHaveLength(1);
    expect(picked[0]).toMatchObject({ fieldKey: 'contact.email' });
    expect(inspector.active()).toBe(false);

    inspector.start();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    expect(inspector.active()).toBe(false);
    expect(hovered.at(-1)).toBeNull();
    expect(postSpy).not.toHaveBeenCalled();
  });
});
