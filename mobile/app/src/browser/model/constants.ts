// Fixed values of the fill browser. NEEDS_TIMEOUT_MS and FRAME_TIMEOUT_MS are copies of the extension's
// (src/background/frames.ts imports wxt/browser, so it cannot be imported here; follow-up: move them to a pure module).

/** The demo form is served by WebViewAssetLoader from assets/raf/demo/, on its own host. */
export const DEMO_ORIGIN = 'https://appassets.androidplatform.net';
export const DEMO_URL = `${DEMO_ORIGIN}/demo/form.html`;

/** Per-frame budget for `needs` (a scan only). Copied from src/background/frames.ts. */
export const NEEDS_TIMEOUT_MS = 5_000;
/** Per-frame budget for `fill`. Copied from src/background/frames.ts. */
export const FRAME_TIMEOUT_MS = 30_000;
/** No main-frame hello this long after `finished` → the engine is missing. */
export const HELLO_TIMEOUT_MS = 8_000;
export const UNDO_TIMEOUT_MS = 5_000;
export const FOCUS_TIMEOUT_MS = 2_000;

/** More expanded leaves than this across frames → ask before filling. */
export const LARGE_NEEDS = 200;
/** Files bigger than this are never handed to a page. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const TOAST_MS = 4_000;
