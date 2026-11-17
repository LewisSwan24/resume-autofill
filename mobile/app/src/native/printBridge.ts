// Native print bridge for Android (`PrintManager`) and iOS (`UIPrintInteractionController`) with Web fallback.
import { registerPlugin } from '@capacitor/core';

export interface PrintBridgePlugin {
  printHtml(options: { html: string; jobName: string }): Promise<{ started: boolean }>;
}

export function createPrintBridge(): PrintBridgePlugin {
  return registerPlugin<PrintBridgePlugin>('PrintBridge');
}

/** Print HTML via Capacitor native print dialog on devices, or `window.print()` fallback in web previews. */
export async function printResumeOffline(
  html: string,
  jobName: string,
  plugin: PrintBridgePlugin = createPrintBridge(),
): Promise<boolean> {
  try {
    const res = await plugin.printHtml({ html, jobName });
    if (res?.started) return true;
  } catch {
    /* Running in browser preview without native Capacitor runtime; fall through to iframe print */
  }
  if (typeof document === 'undefined') return false;
  const frame = document.createElement('iframe');
  frame.style.position = 'fixed';
  frame.style.right = '0';
  frame.style.bottom = '0';
  frame.style.width = '0';
  frame.style.height = '0';
  frame.style.border = '0';
  frame.srcdoc = html;
  document.body.appendChild(frame);
  return new Promise<boolean>((resolve) => {
    setTimeout(() => {
      try {
        frame.contentWindow?.focus();
        frame.contentWindow?.print();
        resolve(true);
      } catch {
        resolve(false);
      } finally {
        setTimeout(() => frame.remove(), 1000);
      }
    }, 50);
  });
}
