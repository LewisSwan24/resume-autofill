// The library builds reader.ts loads. Only what it calls; src/import/extract holds the shapes it relies on.
// mammoth's browser build is declared once, in src/import/vendor.d.ts, and shared from there.
/// <reference path="../../../../src/import/vendor.d.ts" />

declare module 'pdfjs-dist/legacy/build/pdf.min.mjs' {
  export const GlobalWorkerOptions: { workerPort: Worker | null; workerSrc: string };
  export const getDocument: unknown;
}
