// The docked sheet of the fill browser: a panel below the page (never over it), on the back stack like Sheet, reporting
// its height and whether it is modal to the screen, with focus on its title while open and back on the opener after.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMemo, useState } from 'react';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { DockContext, DockedSheet, type DockHost } from '../../../../mobile/app/src/browser/DockedSheet';
import { BackStackContext, createBackStack, type BackStack } from '../../../../mobile/app/src/ui';
import { setLanguage } from '../../../../src/i18n';

/** ResizeObserver stand-in: tests call `resizeAll(height)` to report a size. */
const observers = new Set<{ cb: ResizeObserverCallback; targets: Element[] }>();
class FakeResizeObserver {
  private entry: { cb: ResizeObserverCallback; targets: Element[] };
  constructor(cb: ResizeObserverCallback) {
    this.entry = { cb, targets: [] };
    observers.add(this.entry);
  }
  observe(el: Element) {
    this.entry.targets.push(el);
  }
  unobserve() {}
  disconnect() {
    observers.delete(this.entry);
  }
}
function resizeAll(height: number) {
  for (const o of observers) {
    for (const el of o.targets) {
      vi.spyOn(el, 'getBoundingClientRect').mockReturnValue({ height, width: 360, top: 0, left: 0, right: 360, bottom: height, x: 0, y: 0, toJSON: () => ({}) });
    }
    o.cb([], o as unknown as ResizeObserver);
  }
}

let backStack: BackStack;
let host: { setSheet: ReturnType<typeof vi.fn<DockHost['setSheet']>>; onHeight: ReturnType<typeof vi.fn<DockHost['onHeight']>> };

function Harness({ modal = false }: { modal?: boolean }) {
  const [open, setOpen] = useState(false);
  const value = useMemo<DockHost>(() => host, []);
  return (
    <BackStackContext.Provider value={backStack}>
      <DockContext.Provider value={value}>
        <button type="button" onClick={() => setOpen(true)}>
          打开报告
        </button>
        <DockedSheet open={open} title="填写报告" modal={modal} onClose={() => setOpen(false)}>
          <p>内容</p>
        </DockedSheet>
      </DockContext.Provider>
    </BackStackContext.Provider>
  );
}

beforeEach(() => {
  setLanguage('zh');
  backStack = createBackStack();
  host = { setSheet: vi.fn<DockHost['setSheet']>(), onHeight: vi.fn<DockHost['onHeight']>() };
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  observers.clear();
});

describe('DockedSheet', () => {
  it('is a dialog named by its title, not modal by default, and draws no scrim of its own', () => {
    render(<Harness />);
    expect(screen.queryByRole('dialog')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '打开报告' }));
    const sheet = screen.getByRole('dialog', { name: '填写报告' });
    expect(sheet.getAttribute('aria-modal')).toBeNull();
    expect(document.querySelector('.m-scrim')).toBeNull();
    expect(sheet.closest('.m-sheet-layer')).toBeNull();
    expect(screen.getByRole('button', { name: '关闭' })).toBeTruthy();
  });

  it('registers on the back stack: back closes it', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '打开报告' }));
    act(() => {
      expect(backStack.pop()).toBe(true);
    });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(backStack.pop()).toBe(false);
  });

  it('tells the screen it is open (with modal false) and closed again', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '打开报告' }));
    expect(host.setSheet).toHaveBeenLastCalledWith({ open: true, modal: false });
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(host.setSheet).toHaveBeenLastCalledWith({ open: false, modal: false });
  });

  it('modal: aria-modal and setSheet with modal true', () => {
    render(<Harness modal />);
    fireEvent.click(screen.getByRole('button', { name: '打开报告' }));
    expect(screen.getByRole('dialog').getAttribute('aria-modal')).toBe('true');
    expect(host.setSheet).toHaveBeenLastCalledWith({ open: true, modal: true });
    act(() => void backStack.pop());
    expect(host.setSheet).toHaveBeenLastCalledWith({ open: false, modal: false });
  });

  it('reports its height when it changes size, and 0 when it closes', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: '打开报告' }));
    act(() => resizeAll(240));
    expect(host.onHeight).toHaveBeenLastCalledWith(240);
    fireEvent.click(screen.getByRole('button', { name: '关闭' }));
    expect(host.onHeight).toHaveBeenLastCalledWith(0);
  });

  it('focus goes to the title on open and back to the opener on close; Esc closes', () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: '打开报告' });
    opener.focus();
    fireEvent.click(opener);
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: '填写报告' }));
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });
});
