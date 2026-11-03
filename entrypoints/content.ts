import { startContentScript } from '../src/content';

export default defineContentScript({
  matches: ['<all_urls>'],
  allFrames: true,
  runAt: 'document_idle',
  // world defaults to ISOLATED
  main(ctx) {
    ctx.onInvalidated(startContentScript());
  },
});
