// Turns a page into static HTML, in the page itself: Playwright evaluates it in the command-line capture, and the
// extension's recorder injects it into each frame of the tab. It may use nothing from outside its own body.
export interface Serialized {
  html: string;
  css: string;
  crossOriginSheets: string[];
}

/** Runs in the page. */
export function serializeInPage(): Serialized {
  const shadowRoots: ShadowRoot[] = [];
  const walk = (root: ParentNode): void => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        shadowRoots.push(el.shadowRoot);
        walk(el.shadowRoot);
      }
    }
  };
  walk(document);

  const css: string[] = [];
  const crossOriginSheets: string[] = [];
  const readSheet = (sheet: CSSStyleSheet): void => {
    try {
      css.push([...sheet.cssRules].map((r) => r.cssText).join('\n'));
    } catch {
      if (sheet.href) crossOriginSheets.push(sheet.href);
    }
  };
  for (const sheet of document.styleSheets) readSheet(sheet);
  for (const root of shadowRoots) for (const sheet of root.adoptedStyleSheets) readSheet(sheet);

  const rootEl = document.documentElement as HTMLElement & {
    getHTML(o: { serializableShadowRoots?: boolean; shadowRoots?: ShadowRoot[] }): string;
  };
  const shell = rootEl.cloneNode(false) as HTMLElement;
  shell.innerHTML = '@@BODY@@';
  const html = `<!doctype html>${shell.outerHTML.replace('@@BODY@@', () => rootEl.getHTML({ serializableShadowRoots: true, shadowRoots }))}`;
  return { html, css: css.join('\n'), crossOriginSheets };
}
