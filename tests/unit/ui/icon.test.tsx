import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ICONS, ICON_NAMES, Icon, type IconName } from '../../../src/ui/Icon';

afterEach(cleanup);

const REQUIRED: IconName[] = [
  'file-earmark-text', 'file-earmark-check', 'check-circle', 'exclamation-circle', 'question-circle', 'x-circle',
  'info-circle', 'exclamation-triangle', 'x-lg', 'search', 'arrow-clockwise', 'chevron-down', 'chevron-up',
  'arrow-up', 'arrow-down', 'trash', 'plus-lg', 'upload', 'three-dots', 'check-lg', 'pencil', 'box-arrow-up-right',
  'gear', 'layout-sidebar-reverse',
  // options page (M1.2-D)
  'paperclip', 'arrow-counterclockwise', 'download', 'arrow-left-right', 'copy', 'link-45deg',
  // the profile page and the help page, reached from every surface ('question-circle' already means "not recognized")
  'person-vcard', 'book',
];

describe('<Icon>', () => {
  it('registers exactly the planned icons, each a Bootstrap Icons SVG', () => {
    expect([...ICON_NAMES].sort()).toEqual([...REQUIRED].sort());
    for (const name of ICON_NAMES) {
      expect(ICONS[name], name).toMatch(/^<svg\b[\s\S]*viewBox="0 0 16 16"[\s\S]*<path\b[\s\S]*<\/svg>\s*$/);
    }
  });

  it('renders an inline SVG with the icon paths and fill currentColor', () => {
    const { container } = render(<Icon name="check-circle" />);
    const svg = container.querySelector('svg')!;
    expect(svg).not.toBeNull();
    expect(svg.getAttribute('fill')).toBe('currentColor');
    expect(svg.getAttribute('viewBox')).toBe('0 0 16 16');
    expect(svg.getAttribute('data-icon')).toBe('check-circle');
    expect(svg.querySelectorAll('path').length).toBeGreaterThan(0);
    // The wrapper `<svg>` of the raw file is not nested inside ours.
    expect(svg.querySelector('svg')).toBeNull();
    // No hard-coded colour ends up in the markup.
    expect(svg.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b|rgb\(/i);
  });

  it('is decorative by default (aria-hidden, no role, no name)', () => {
    const { container } = render(<Icon name="trash" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(svg.hasAttribute('role')).toBe(false);
    expect(svg.hasAttribute('aria-label')).toBe(false);
    expect(svg.getAttribute('focusable')).toBe('false');
  });

  it('becomes role="img" with an aria-label when a label is given', () => {
    const { container, getByRole } = render(<Icon name="check-circle" label="Filled" />);
    const svg = container.querySelector('svg')!;
    expect(svg.getAttribute('role')).toBe('img');
    expect(svg.getAttribute('aria-label')).toBe('Filled');
    expect(svg.hasAttribute('aria-hidden')).toBe(false);
    expect(getByRole('img', { name: 'Filled' })).toBe(svg);
  });

  it('defaults to var(--raf-size-glyph) and accepts a number (px) or a CSS length', () => {
    const style = (el: ReturnType<typeof render>['container']) => el.querySelector('svg')!.style;
    expect(style(render(<Icon name="x-lg" />).container).width).toBe('var(--raf-size-glyph)');
    expect(style(render(<Icon name="x-lg" />).container).height).toBe('var(--raf-size-glyph)');
    expect(style(render(<Icon name="x-lg" size={24} />).container).width).toBe('24px');
    expect(style(render(<Icon name="x-lg" size="1.5em" />).container).height).toBe('1.5em');
  });

  it('adds a custom class next to raf-icon', () => {
    const { container } = render(<Icon name="gear" className="mine" />);
    expect(container.querySelector('svg')!.getAttribute('class')).toBe('raf-icon mine');
  });

  it('renders every registered icon without throwing', () => {
    for (const name of ICON_NAMES) {
      const { container, unmount } = render(<Icon name={name} />);
      expect(container.querySelectorAll('svg > path').length, name).toBeGreaterThan(0);
      unmount();
    }
  });
});
