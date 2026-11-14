// Where pdf.js finds its worker and its font tables: inside the app, never on the network.

/** Under the app's web root, written there at build time by vite/localPdfAssets.ts. */
export const PDF_ASSET_DIR = 'pdfjs';
export const PDF_WORKER_FILE = 'pdf.worker.min.mjs';

/**
 * Absolute URLs, because a relative cMapUrl would be read against the worker script. On the phone the base is the
 * app's own origin, served from the APK.
 */
export function pdfAssetUrls(base: string = document.baseURI): { worker: string; cMaps: string } {
  return {
    worker: new URL(`${PDF_ASSET_DIR}/${PDF_WORKER_FILE}`, base).href,
    cMaps: new URL(`${PDF_ASSET_DIR}/cmaps/`, base).href,
  };
}
