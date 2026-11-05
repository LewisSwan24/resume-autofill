// The two browser builds read.ts loads. Only what it calls, and extract/ holds the shapes it relies on.
declare module 'pdfjs-dist/build/pdf.min.mjs' {
  export const GlobalWorkerOptions: { workerSrc: string };
  export const getDocument: unknown;
}

declare module 'mammoth/mammoth.browser.min.js' {
  const mammoth: { convertToHtml: unknown };
  export default mammoth;
}
