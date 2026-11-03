import { describe, expect, it } from 'vitest';
import { fakeBrowser } from 'wxt/testing/fake-browser';

describe('test environment', () => {
  it('round-trips values through fakeBrowser.storage.local', async () => {
    await fakeBrowser.storage.local.set({ greeting: 'hello', n: 42 });
    const stored = await fakeBrowser.storage.local.get(['greeting', 'n']);
    expect(stored).toEqual({ greeting: 'hello', n: 42 });
  });

  it('provides IndexedDB via fake-indexeddb', () => {
    expect(typeof indexedDB.open).toBe('function');
  });
});