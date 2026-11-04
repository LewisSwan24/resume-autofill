// FAB + summary card, top frame only, inside a CLOSED shadow root hosted by `<raf-fab>`.
// Styles (style.css) live in the shadow root only (`cssInjectionMode: 'ui'`).
// Tokens first (src/ui/theme.css), then the component rules; both land in the shadow root only.
import '../../src/ui/theme.css';
import './style.css';
import ReactDOM from 'react-dom/client';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import { Fab } from './Fab';
import { keepAttached } from './keepAttached';
import { syncUiLanguage } from './language';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: false, // top frame only
  runAt: 'document_idle',
  cssInjectionMode: 'ui',
  // Don't announce ourselves (and our extension id) to the page via window.postMessage.
  noScriptStartedPostMessage: true,
  async main(ctx) {
    if (window.top !== window || !document.body) return;
    // Defensive: never mount twice (e.g. after an extension reload without a page refresh).
    if (document.querySelector('raf-fab')) return;

    const stopLanguageSync = syncUiLanguage();
    ctx.onInvalidated(stopLanguageSync);

    const ui = await createShadowRootUi(ctx, {
      name: 'raf-fab',
      mode: 'closed',
      // 'inline' = WXT adds no positioning; placement (fixed, bottom-right, z-index) is defined in
      // style.css via `:host` so the host box equals the FAB button (geometry contract there).
      position: 'inline',
      anchor: 'body',
      append: 'last',
      // We reset the host ourselves (`:host { all: initial }`) so our !important placement rules win.
      inheritStyles: true,
      isolateEvents: true,
      onMount(container) {
        const root = ReactDOM.createRoot(container);
        root.render(<Fab />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });
    ui.mount();
    ctx.onInvalidated(keepAttached(ui.shadowHost, document));
  },
});
