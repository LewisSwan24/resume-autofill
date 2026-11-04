// Vite raw imports of SVG files (also declared by vite/client as `*?raw`; kept explicit so tsc never depends on it).
declare module '*.svg?raw' {
  const content: string;
  export default content;
}

