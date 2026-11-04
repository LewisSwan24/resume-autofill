import { startContentScript } from '../src/content';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  // world defaults to ISOLATED
  // Don't announce ourselves (and our extension id) to the page via window.postMessage.
  noScriptStartedPostMessage: true,
  main(ctx) {
    ctx.onInvalidated(startContentScript());
  },
});
