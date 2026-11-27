// The command-line capture's HTML parser: jsdom, which the extension cannot load.
import { JSDOM } from 'jsdom';
import type { HtmlDom } from '../../src/capture/sanitize.ts';

const owners = new WeakMap<Document, JSDOM>();

export const jsdomHtml: HtmlDom = {
  parse(html) {
    const dom = new JSDOM(html);
    const doc = dom.window.document as unknown as Document;
    owners.set(doc, dom);
    return doc;
  },
  serialize: (doc) => owners.get(doc)?.serialize() ?? doc.documentElement.outerHTML,
};
