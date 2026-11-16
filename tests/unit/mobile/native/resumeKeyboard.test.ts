// @vitest-environment node
// The fake of the ResumeKeyboard plugin (mobile/app/src/native/resumeKeyboard.ts) behaves like ResumeKeyboardPlugin.java.
import { describe, expect, it } from 'vitest';
import {
  createFakeResumeKeyboard,
  RESUME_KEYBOARD_EVENTS,
  RESUME_KEYBOARD_ID,
  RESUME_KEYBOARD_MAX_BYTES,
  RESUME_KEYBOARD_METHODS,
  type KeyboardStatus,
} from '../../../../mobile/app/src/native/resumeKeyboard';

describe('resume keyboard contract', () => {
  it('names the methods, the event, the size limit and the IME id', () => {
    expect(RESUME_KEYBOARD_METHODS).toEqual(['status', 'openInputMethodSettings', 'showPicker', 'writeData', 'clearData']);
    expect(RESUME_KEYBOARD_EVENTS).toEqual(['stateChange']);
    expect(RESUME_KEYBOARD_MAX_BYTES).toBe(524288);
    expect(RESUME_KEYBOARD_ID).toBe('app.raf.dev/.keyboard.ResumeKeyboardService');
  });

  it('the fake records calls and answers status from its state', async () => {
    const fake = createFakeResumeKeyboard({ enabled: true });
    expect(await fake.status()).toEqual({ available: true, enabled: true, current: false });
    expect(await fake.openInputMethodSettings()).toEqual({ opened: true });
    expect(await fake.showPicker()).toEqual({ shown: true });
    await fake.writeData({ data: '{"v":1}' });
    expect(fake.calls.map((c) => c.method)).toEqual(['status', 'openInputMethodSettings', 'showPicker', 'writeData']);
    expect(fake.calls[3]!.args).toEqual({ data: '{"v":1}' });
    expect(fake.stored).toBe('{"v":1}');
  });

  it('writeData over the byte limit rejects TOO_LARGE and keeps what was stored', async () => {
    const fake = createFakeResumeKeyboard({ stored: 'old' });
    // 中 is three UTF-8 bytes, so this is over the limit in bytes while under it in characters.
    const big = '中'.repeat(Math.floor(RESUME_KEYBOARD_MAX_BYTES / 3) + 1);
    expect(big.length).toBeLessThan(RESUME_KEYBOARD_MAX_BYTES);
    await expect(fake.writeData({ data: big })).rejects.toMatchObject({ code: 'TOO_LARGE' });
    expect(fake.stored).toBe('old');
  });

  it('failWrites rejects WRITE_FAILED', async () => {
    const fake = createFakeResumeKeyboard();
    fake.failWrites = true;
    await expect(fake.writeData({ data: '{}' })).rejects.toMatchObject({ code: 'WRITE_FAILED' });
    expect(fake.stored).toBeNull();
  });

  it('setState fires stateChange with the whole status, until the listener is removed', async () => {
    const fake = createFakeResumeKeyboard();
    const seen: KeyboardStatus[] = [];
    const handle = await fake.addListener('stateChange', (s) => seen.push(s));
    fake.setState({ enabled: true });
    expect(seen).toEqual([{ available: true, enabled: true, current: false }]);
    expect(await fake.status()).toEqual({ available: true, enabled: true, current: false });
    await handle.remove();
    fake.setState({ current: true });
    expect(seen).toHaveLength(1);
    expect(fake.state.current).toBe(true);
  });

  it('clearData empties stored and says whether something was removed', async () => {
    const fake = createFakeResumeKeyboard({ stored: '{"v":1}' });
    expect(await fake.clearData()).toEqual({ removed: true });
    expect(fake.stored).toBeNull();
    expect(await fake.clearData()).toEqual({ removed: false });
  });
});
