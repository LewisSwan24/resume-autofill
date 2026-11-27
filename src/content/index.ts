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

/** How often a fill tells the background it is still at work: well inside the background's budget for a frame. */
const ALIVE_EVERY_MS = 2_000;

/** Start the content script in `doc`; returns a stop function (extension context invalidated). */
export function startContentScript(doc: Document = document): () => void {
  registerAllDrivers();

  let handlers: ReturnType<typeof createFrameHandlers>;
  let lastAlive = 0;
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
    onProgress: () => {
      const now = Date.now();
      if (now - lastAlive < ALIVE_EVERY_MS) return;
      lastAlive = now;
      void sendToBackground({ type: 'frame:alive' }).catch(() => undefined);
    },
    onInspectorHover: (target) => {
      void sendToBackground({ type: 'inspector:hover', target }).catch(() => undefined);
    },
    onInspectorPick: (target) => {
      void sendToBackground({ type: 'inspector:picked', url: doc.location?.href ?? '', target }).catch(() => undefined);
    },
  });

  // Every frame says what step it shows and can press its own Next: a form may sit in an iframe. The background
  // merges what the frames say (src/background/frameSteps.ts) and presses in the one frame that has Next.
  const steps = createStepHandlers(doc, {
    adapterStep: () => resolveAdapter(doc)?.stepSignature?.(doc) ?? null,
    adapterNext: () => resolveAdapter(doc)?.nextButton,
  });
  const listener = createContentListener(handlers, steps);
  browser.runtime.onMessage.addListener(listener);
  watcher.start();
  scan(); // initial scan right away; the observer only reacts to later changes
  return () => {
    browser.runtime.onMessage.removeListener(listener);
    watcher.stop();
    steps.stop();
  };
}
