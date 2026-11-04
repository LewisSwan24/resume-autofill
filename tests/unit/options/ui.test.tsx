import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { setLanguage } from '../../../src/i18n';
import { Dialog } from '../../../entrypoints/options/ui/Dialog';
import { TagInput, splitWords } from '../../../entrypoints/options/ui/TagInput';
import { TOAST_MS, ToastProvider, useToast } from '../../../entrypoints/options/ui/Toast';
import { Segmented } from '../../../entrypoints/options/ui/controls';

beforeEach(() => setLanguage('en'));
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Tags({ initial = [], onChange }: { initial?: string[]; onChange?: (v: string[]) => void }) {
  const [value, setValue] = useState<string[]>(initial);
  return (
    <TagInput
      aria-label="Cities"
      value={value}
      onChange={(v) => {
        setValue(v);
        onChange?.(v);
      }}
    />
  );
}

describe('TagInput', () => {
  const box = () => screen.getByLabelText('Cities') as HTMLInputElement;

  it('adds the typed word on Enter and clears the box', () => {
    const onChange = vi.fn();
    render(<Tags onChange={onChange} />);
    fireEvent.change(box(), { target: { value: 'Perth' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['Perth']);
    expect(box().value).toBe('');
    expect(screen.getByText('Perth')).toBeTruthy();
  });

  it('does not add anything while an IME is composing (isComposing or keyCode 229)', () => {
    const onChange = vi.fn();
    render(<Tags onChange={onChange} />);
    fireEvent.change(box(), { target: { value: '杭' } });
    fireEvent.keyDown(box(), { key: 'Enter', isComposing: true });
    fireEvent.keyDown(box(), { key: 'Enter', keyCode: 229 });
    expect(onChange).not.toHaveBeenCalled();
    expect(box().value).toBe('杭');
    // The same key after the composition ended adds the word.
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith(['杭']);
  });

  it('ignores Enter on an empty box and duplicate words', () => {
    const onChange = vi.fn();
    render(<Tags initial={['Perth']} onChange={onChange} />);
    fireEvent.keyDown(box(), { key: 'Enter' });
    fireEvent.change(box(), { target: { value: 'Perth' } });
    fireEvent.keyDown(box(), { key: 'Enter' });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getAllByText('Perth')).toHaveLength(1);
  });

  it('splits on ASCII and full-width commas and keeps the text after the last one', () => {
    const onChange = vi.fn();
    render(<Tags onChange={onChange} />);
    fireEvent.change(box(), { target: { value: '深圳，杭州、上' } });
    expect(onChange).toHaveBeenLastCalledWith(['深圳', '杭州']);
    expect(box().value).toBe('上');
    expect(splitWords('a, b；c\nd')).toEqual(['a', 'b', 'c', 'd']);
  });

  it('adds a pending word on blur', () => {
    const onChange = vi.fn();
    render(<Tags onChange={onChange} />);
    fireEvent.change(box(), { target: { value: 'Sydney' } });
    fireEvent.blur(box());
    expect(onChange).toHaveBeenLastCalledWith(['Sydney']);
  });

  it('removes a tag with its named button and the last one with Backspace on an empty box', () => {
    const onChange = vi.fn();
    render(<Tags initial={['Perth', 'Sydney', 'Hobart']} onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Remove Sydney' }));
    expect(onChange).toHaveBeenLastCalledWith(['Perth', 'Hobart']);
    fireEvent.keyDown(box(), { key: 'Backspace' });
    expect(onChange).toHaveBeenLastCalledWith(['Perth']);
    // Backspace with text in the box only edits the text.
    fireEvent.change(box(), { target: { value: 'x' } });
    onChange.mockClear();
    fireEvent.keyDown(box(), { key: 'Backspace' });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('Dialog', () => {
  const setup = () => {
    const onCancel = vi.fn();
    const onConfirm = vi.fn();
    render(
      <Dialog title="Delete this resume?" text="It can't be undone." cancelLabel="Not now" confirmLabel="Delete resume" danger onCancel={onCancel} onConfirm={onConfirm} />,
    );
    return { onCancel, onConfirm, dialog: screen.getByRole('dialog', { name: 'Delete this resume?' }) };
  };

  it('is labelled by its question, described by its text, and focuses the safe button', () => {
    const { dialog } = setup();
    expect(dialog.getAttribute('aria-describedby')).toBeTruthy();
    expect(document.getElementById(dialog.getAttribute('aria-describedby')!)?.textContent).toBe("It can't be undone.");
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Not now' }));
  });

  it('confirms with the named action, cancels with the safe button and with Esc', () => {
    const { dialog, onCancel, onConfirm } = setup();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete resume' }));
    expect(onConfirm).toHaveBeenCalledTimes(1);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    fireEvent(dialog, new Event('cancel', { cancelable: true }));
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('gives focus back to the element that had it before opening', () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <>
          <button onClick={() => setOpen(true)}>Open</button>
          {open ? <Dialog title="Sure?" text="Really." cancelLabel="Not now" confirmLabel="Yes, do it" onCancel={() => setOpen(false)} onConfirm={() => setOpen(false)} /> : null}
        </>
      );
    }
    render(<Host />);
    const opener = screen.getByRole('button', { name: 'Open' });
    opener.focus();
    fireEvent.click(opener);
    fireEvent.click(screen.getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});

describe('Toast', () => {
  function Host({ onUndo, danger = false }: { onUndo?: () => void; danger?: boolean }) {
    const toast = useToast();
    return (
      <button onClick={() => toast.push({ text: 'Education 2 removed', danger, action: onUndo ? { label: 'Undo', onClick: onUndo } : undefined })}>Remove</button>
    );
  }
  const push = () => fireEvent.click(screen.getByRole('button', { name: 'Remove' }));

  it('shows the message with an Undo action that runs once and dismisses the toast', () => {
    vi.useFakeTimers();
    const onUndo = vi.fn();
    render(
      <ToastProvider>
        <Host onUndo={onUndo} />
      </ToastProvider>,
    );
    push();
    const toast = screen.getByRole('status');
    expect(toast.textContent).toContain('Education 2 removed');
    fireEvent.click(within(toast).getByRole('button', { name: 'Undo' }));
    expect(onUndo).toHaveBeenCalledTimes(1);
    act(() => void vi.advanceTimersByTime(400));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('leaves by itself after 5 seconds, but not while the pointer is on it', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Host />
      </ToastProvider>,
    );
    push();
    const toast = screen.getByRole('status');
    fireEvent.mouseEnter(toast);
    act(() => void vi.advanceTimersByTime(TOAST_MS + 1000));
    expect(screen.getByRole('status')).toBeTruthy();
    fireEvent.mouseLeave(toast);
    act(() => void vi.advanceTimersByTime(TOAST_MS + 10));
    act(() => void vi.advanceTimersByTime(400));
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('keeps an error toast (role=alert) until it is closed', () => {
    vi.useFakeTimers();
    render(
      <ToastProvider>
        <Host danger />
      </ToastProvider>,
    );
    push();
    act(() => void vi.advanceTimersByTime(TOAST_MS * 3));
    const alert = screen.getByRole('alert');
    fireEvent.click(within(alert).getByRole('button', { name: 'Close' }));
    act(() => void vi.advanceTimersByTime(400));
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('shows at most 3 toasts at once', () => {
    render(
      <ToastProvider>
        <Host />
      </ToastProvider>,
    );
    for (let i = 0; i < 5; i += 1) push();
    expect(screen.getAllByRole('status')).toHaveLength(3);
  });
});

describe('Segmented', () => {
  it('is a radio group; picking an option reports its value', () => {
    const onChange = vi.fn();
    render(
      <Segmented
        label="Locale"
        value="a"
        options={[
          { value: 'a', label: 'zh-CN' },
          { value: 'b', label: 'en-AU' },
        ]}
        onChange={onChange}
      />,
    );
    const group = screen.getByRole('radiogroup', { name: 'Locale' });
    expect(within(group).getByRole('radio', { name: 'zh-CN' })).toHaveProperty('checked', true);
    fireEvent.click(within(group).getByRole('radio', { name: 'en-AU' }));
    expect(onChange).toHaveBeenCalledWith('b');
  });
});
