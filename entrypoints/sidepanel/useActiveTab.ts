// Id of the tab the side panel describes: `?tabId=<n>` override, else the active tab of this window.
import { useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import { parseTabIdOverride } from './model';

async function queryActiveTabId(): Promise<number | null> {
  try {
    const tabs = await browser.tabs.query({ active: true, currentWindow: true });
    return tabs.find((tab) => typeof tab.id === 'number')?.id ?? null;
  } catch {
    return null;
  }
}

export function useActiveTab(search: string = typeof location === 'undefined' ? '' : location.search): number | null {
  const override = parseTabIdOverride(search);
  const [tabId, setTabId] = useState<number | null>(override);

  useEffect(() => {
    if (override !== null) {
      setTabId(override);
      return;
    }
    let cancelled = false;
    const refresh = () => {
      void queryActiveTabId().then((id) => {
        if (!cancelled) setTabId(id);
      });
    };
    refresh();
    const onUpdated = (_id: number, change: { status?: string }, tab: { active?: boolean }) => {
      if (change.status === 'complete' && tab.active) refresh();
    };
    browser.tabs.onActivated.addListener(refresh);
    browser.tabs.onUpdated.addListener(onUpdated);
    return () => {
      cancelled = true;
      browser.tabs.onActivated.removeListener(refresh);
      browser.tabs.onUpdated.removeListener(onUpdated);
    };
  }, [override]);

  return tabId;
}
