// Content script wiring (all frames): scan → report count, handle fill / focus / apply commands.
import { browser } from 'wxt/browser';
import { resolveAdapter } from '../adapters/resolve';
import { registerAllDrivers } from '../drivers';
import { scanDocument } from '../engine/scan';
import { sendToBackground } from '../messaging';
import { createFrameHandlers } from './handlers';
import { idFor } from './ids';
import { createContentListener } from './listener';
import { createStepHandlers } from './steps';
import { createScanWatcher } from './watcher';

export * from './handlers';
export * from './ids';
export * from './inspector';
export * from './intent';
export * from './listener';
export * from './needs';
export * from './steps';
export * from './watcher';

/** Start the content script in `doc`; returns a stop function (extension context invalidated). */
export function startContentScript(doc: Document = document): () => void {
  registerAllDrivers();

  let handlers: ReturnType<typeof createFrameHandlers>;
  const scan = () => {
    try {
      const { fillableCount } = scanDocument(doc, idFor);
      void sendToBackground({ type: 'scan:result', count: fillableCount, url: doc.location?.href ?? '' }).catch(
        () => undefined,
      );
    } catch {
      /* a page we cannot scan must never break the page itself */
    }
  };
  const watcher = createScanWatcher({
    doc,
    scan,
    isBusy: () => handlers.isBusy(),
    stepSignature: () => resolveAdapter(doc)?.stepSignature?.(doc) ?? null,
  });
  handlers = createFrameHandlers({
    doc,
    idFor,
    discardOwnWrites: () => watcher.discardOwnWrites(),
    onIdle: () => watcher.schedule(),
    onInspectorHover: (target) => {
      void sendToBackground({ type: 'inspector:hover', target }).catch(() => undefined);
    },
    onInspectorPick: (target) => {
      void sendToBackground({ type: 'inspector:picked', url: doc.location?.href ?? '', target }).catch(() => undefined);
    },
  });

  // Only the top frame moves a multi-step form on; the FAB that starts it lives there too.
  const isTop = doc.defaultView === doc.defaultView?.top;
  const steps = isTop
    ? createStepHandlers(doc, {
        adapterStep: () => resolveAdapter(doc)?.stepSignature?.(doc) ?? null,
        adapterNext: () => resolveAdapter(doc)?.nextButton,
      })
    : undefined;
  const listener = createContentListener(handlers, steps);
  browser.runtime.onMessage.addListener(listener);
  watcher.start();
  scan(); // initial scan right away; the observer only reacts to later changes
  return () => {
    browser.runtime.onMessage.removeListener(listener);
    watcher.stop();
    steps?.stop();
  };
}
