// The shell hides the tab bar while the on-screen keyboard is open. Tapping a button below a text field moves focus
// off the field before the keyboard has gone; if the tab bar came back at that moment it would land under the
// finger, so it must stay hidden until the viewport has actually grown back.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { useKeyboardOpen } from '../../../mobile/app/src/TabBar';

class FakeViewport extends EventTarget {
  width = 400;
  height = 800;
  resize(height: number) {
    this.height = height;
    this.dispatchEvent(new Event('resize'));
  }
}

let viewport: FakeViewport;
const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');

beforeEach(() => {
  viewport = new FakeViewport();
  Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
});

afterEach(() => {
  cleanup();
  if (original) Object.defineProperty(window, 'visualViewport', original);
  else delete (window as { visualViewport?: unknown }).visualViewport;
});

function Probe() {
  const open = useKeyboardOpen();
  return (
    <div>
      <input aria-label="field" />
      <button type="button">pick</button>
      <output aria-label="state">{open ? 'open' : 'closed'}</output>
    </div>
  );
}

const state = () => screen.getByLabelText('state').textContent;

describe('useKeyboardOpen', () => {
  it('is open while a text field has focus and the viewport has shrunk', () => {
    render(<Probe />);
    act(() => screen.getByLabelText('field').focus());
    expect(state()).toBe('closed');
    act(() => viewport.resize(450));
    expect(state()).toBe('open');
  });

  it('stays open when focus moves to a button while the keyboard is still up', () => {
    render(<Probe />);
    act(() => screen.getByLabelText('field').focus());
    act(() => viewport.resize(450));
    act(() => screen.getByRole('button', { name: 'pick' }).focus());
    expect(state()).toBe('open');
  });

  it('closes once the viewport grows back', () => {
    render(<Probe />);
    act(() => screen.getByLabelText('field').focus());
    act(() => viewport.resize(450));
    act(() => screen.getByRole('button', { name: 'pick' }).focus());
    act(() => viewport.resize(800));
    expect(state()).toBe('closed');
  });

  it('does not open when the viewport shrinks without a text field focused', () => {
    render(<Probe />);
    act(() => screen.getByRole('button', { name: 'pick' }).focus());
    act(() => viewport.resize(450));
    expect(state()).toBe('closed');
  });
});
