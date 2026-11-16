// Pre-fill preview state for one tab: read from `storage.session` (`preview:<tabId>`) and kept fresh.
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { FillPreview } from '../../src/engine/types';
import { isFromExtension, isValidMessage } from '../../src/messaging';

export const previewStorageKey = (tabId: number): string => `preview:${tabId}`;

function isFillPreview(x: unknown): x is FillPreview {
  if (typeof x !== 'object' || x === null) return false;
  const p = x as Partial<FillPreview>;
  return typeof p.tabId === 'number' && Array.isArray(p.items) && Array.isArray(p.cardDemand);
}

export function usePreview(tabId: number | null, enabled: boolean): FillPreview | null {
  const [preview, setPreview] = useState<FillPreview | null>(null);

  useEffect(() => {
    setPreview(null);
    if (tabId === null || !enabled) return;
    let cancelled = false;
    const key = previewStorageKey(tabId);

    const refresh = () => {
      void browser.storage.session
        .get(key)
        .then((stored) => {
          if (cancelled) return;
          const val = stored[key];
          setPreview(isFillPreview(val) ? val : null);
        })
        .catch(() => undefined);
    };
    refresh();

    const onMessage = (message: unknown, sender: { id?: string; tab?: unknown }) => {
      if (!isFromExtension(sender) || sender.tab != null || !isValidMessage(message)) return;
      if (message.type !== 'preview:updated' || message.tabId !== tabId) return;
      setPreview(message.preview && isFillPreview(message.preview) ? message.preview : null);
    };
    const onStorage = (changes: Record<string, unknown>, area: string) => {
      if (area === 'session' && key in changes) refresh();
    };

    browser.runtime.onMessage.addListener(onMessage);
    browser.storage.onChanged.addListener(onStorage);
    browser.tabs.onActivated.addListener(refresh);
    return () => {
      cancelled = true;
      browser.runtime.onMessage.removeListener(onMessage);
      browser.storage.onChanged.removeListener(onStorage);
      browser.tabs.onActivated.removeListener(refresh);
    };
  }, [tabId, enabled]);

  return preview;
}
