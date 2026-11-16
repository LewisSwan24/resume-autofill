// useKeyboardStatus: reads the keyboard's state on mount, on the plugin's stateChange
// event and when the page becomes visible again; a failed read sets error; no plugin means no calls at all.
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { useKeyboardStatus } from '../../../../mobile/app/src/keyboard/useKeyboardStatus';
import { createFakeResumeKeyboard, type ResumeKeyboardPlugin } from '../../../../mobile/app/src/native/resumeKeyboard';

const WAIT = { timeout: 3000 };

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state });
  document.dispatchEvent(new Event('visibilitychange'));
}

afterEach(() => {
  cleanup();
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' });
});

describe('useKeyboardStatus', () => {
  it('reads the status on mount', async () => {
    const kb = createFakeResumeKeyboard({ enabled: true });
    const { result } = renderHook(() => useKeyboardStatus(kb));
    expect(result.current.status).toBeNull();
    await waitFor(() => expect(result.current.status).toEqual({ available: true, enabled: true, current: false }), WAIT);
    expect(result.current.error).toBe(false);
    expect(kb.calls.filter((c) => c.method === 'status')).toHaveLength(1);
  });

  it('follows the stateChange event', async () => {
    const kb = createFakeResumeKeyboard();
    const { result } = renderHook(() => useKeyboardStatus(kb));
    await waitFor(() => expect(result.current.status?.enabled).toBe(false), WAIT);
    act(() => kb.setState({ enabled: true, current: true }));
    await waitFor(() => expect(result.current.status).toEqual({ available: true, enabled: true, current: true }), WAIT);
  });

  it('reads again when the page becomes visible, not when it is hidden', async () => {
    const kb = createFakeResumeKeyboard();
    const { result } = renderHook(() => useKeyboardStatus(kb));
    await waitFor(() => expect(result.current.status).not.toBeNull(), WAIT);
    kb.state = { ...kb.state, enabled: true }; // changed behind the app's back (system settings)
    act(() => setVisibility('hidden'));
    expect(kb.calls.filter((c) => c.method === 'status')).toHaveLength(1);
    act(() => setVisibility('visible'));
    await waitFor(() => expect(result.current.status?.enabled).toBe(true), WAIT);
    expect(kb.calls.filter((c) => c.method === 'status')).toHaveLength(2);
  });

  it('a failed read sets error, and a later good read clears it', async () => {
    const kb = createFakeResumeKeyboard();
    let fail = true;
    const status = kb.status.bind(kb);
    kb.status = async () => {
      if (fail) throw new Error('boom');
      return status();
    };
    const { result } = renderHook(() => useKeyboardStatus(kb));
    await waitFor(() => expect(result.current.error).toBe(true), WAIT);
    expect(result.current.status).toBeNull();
    fail = false;
    await act(async () => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBe(false), WAIT);
    expect(result.current.status?.available).toBe(true);
  });

  it('with no plugin: no status, no error and nothing called', async () => {
    const { result } = renderHook(() => useKeyboardStatus(null));
    expect(result.current).toMatchObject({ status: null, error: false });
    act(() => setVisibility('visible'));
    await act(async () => result.current.refresh());
    expect(result.current).toMatchObject({ status: null, error: false });
  });

  it('removes its listener on unmount', async () => {
    const kb = createFakeResumeKeyboard();
    let removed = 0;
    const plugin: ResumeKeyboardPlugin = {
      ...kb,
      status: () => kb.status(),
      addListener: async (event, listener) => {
        const handle = await kb.addListener(event, listener);
        return { remove: async () => { removed += 1; await handle.remove(); } };
      },
    };
    const { result, unmount } = renderHook(() => useKeyboardStatus(plugin));
    await waitFor(() => expect(result.current.status).not.toBeNull(), WAIT);
    unmount();
    await waitFor(() => expect(removed).toBe(1), WAIT);
  });
});
