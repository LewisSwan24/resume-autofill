import { afterEach, describe, expect, it, vi } from 'vitest';
import { applyHighlights, clearHighlights, focusField, outlineFor } from '../../../src/fill/highlight';

afterEach(() => {
  clearHighlights();
  document.body.innerHTML = '';
});

const input = (style = '') => {
  const el = document.createElement('input');
  if (style) el.setAttribute('style', style);
  document.body.append(el);
  return el;
};

describe('highlights', () => {
  it('uses the planned colours per outcome and none for no_data', () => {
    expect(outlineFor('filled')).toBe('2px solid #22c55e');
    expect(outlineFor('needs_review')).toBe('2px solid #eab308');
    expect(outlineFor('no_option')).toBe('2px solid #eab308');
    expect(outlineFor('unmatched')).toBe('2px solid #ef4444');
    expect(outlineFor('action_failed')).toBe('2px solid #ef4444');
    expect(outlineFor('no_data')).toBeNull();
  });

  it('applies outlines and restores the original inline style, even after repeated applies', () => {
    const a = input('outline: 1px dotted blue');
    const b = input();
    const c = input();
    applyHighlights([{ el: a, outcome: 'filled' }, { el: b, outcome: 'needs_review' }, { el: c, outcome: 'no_data' }]);
    expect(a.style.outline).toBe('2px solid #22c55e');
    expect(b.style.outline).toBe('2px solid #eab308');
    expect(c.style.outline).toBe('');
    applyHighlights([{ el: a, outcome: 'action_failed' }]);
    expect(a.style.outline).toBe('2px solid #ef4444');
    clearHighlights();
    expect(a.style.outline).toContain('1px dotted');
    expect(a.style.outline).not.toContain('#ef4444');
    expect(b.style.outline).toBe('');
  });

  it('focusField scrolls the element to the centre', () => {
    const el = input();
    el.scrollIntoView = vi.fn();
    focusField(el);
    expect(el.scrollIntoView).toHaveBeenCalledWith(expect.objectContaining({ block: 'center' }));
  });
});

