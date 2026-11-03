// Fill report of one tab: read from `storage.session` (`report:<tabId>`) and kept fresh.
import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { FieldReport, FillReport } from '../../src/engine/types';
import { isFromExtension, isValidMessage } from '../../src/messaging';
import { isFillReport, patchReport, reportStorageKey } from './model';

export interface ReportState {
  report: FillReport | null;
  /** True until the first read for the current tab finished. */
  loading: boolean;
  /** Merge a field result (response of `field:apply`) into the displayed report. */
  patchField: (field: FieldReport) => void;
}

async function readReport(tabId: number): Promise<FillReport | null> {
  try {
    const key = reportStorageKey(tabId);
    const stored = await browser.storage.session.get(key);
    const value = stored[key];
    return isFillReport(value) ? value : null;
  } catch {
    return null;
  }
}

export function useReport(tabId: number | null): ReportState {
  const [report, setReport] = useState<FillReport | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setReport(null);
    if (tabId === null) {
      setLoading(false);
      return;
    }
    setLoading(true);
    let cancelled = false;
    const key = reportStorageKey(tabId);

    const refresh = () => {
      void readReport(tabId).then((next) => {
        if (cancelled) return;
        setReport(next);
        setLoading(false);
      });
    };
    refresh();

    // storage.onChanged also reports the session area (area === 'session'); no separate hook needed.
    // Broadcast from the background: use the payload directly, it is the freshest.
    const onMessage = (message: unknown, sender: { id?: string; tab?: unknown }) => {
      if (!isFromExtension(sender) || sender.tab != null || !isValidMessage(message)) return;
      if (message.type !== 'report:updated' || message.tabId !== tabId) return;
      if (isFillReport(message.report)) {
        setReport(message.report);
        setLoading(false);
      }
    };
    const onStorage = (changes: Record<string, unknown>, area: string) => {
      if (area === 'session' && key in changes) refresh();
    };
    const onTabUpdated = (id: number, change: { status?: string }) => {
      if (id === tabId && change.status === 'complete') refresh();
    };

    browser.runtime.onMessage.addListener(onMessage);
    browser.storage.onChanged.addListener(onStorage);
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(onTabUpdated);
    return () => {
      cancelled = true;
      browser.runtime.onMessage.removeListener(onMessage);
      browser.storage.onChanged.removeListener(onStorage);
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onTabUpdated);
    };
  }, [tabId]);

  const patchField = useCallback((field: FieldReport) => {
    setReport((current) => (current ? patchReport(current, field) : current));
  }, []);

  return { report, loading, patchField };
}
