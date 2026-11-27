// The capture code the extension's recorder and the command-line tool share. The extension cannot load jsdom, so the
// shared code parses HTML with whatever the caller hands it, and with the browser's own DOMParser when given nothing.
// Serialising a page needs a real browser (getHTML, adopted style sheets): tests/drivers covers it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Scrubber, auditHtml, sanitizeStaticHtml, type HtmlDom } from '../../../src/capture/sanitize';

const PAGE = '<!doctype html><html><head><script>x()</script></head><body><input value="a@b.example.com"><!-- c --></body></html>';

describe('shared capture code', () => {
  it('imports nothing that only runs in Node', () => {
    for (const file of ['src/capture/sanitize.ts', 'src/capture/serialize.ts']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/from ['"](?:jsdom|node:[\w/]+)['"]/);
    }
  });

  it('parses with the DOM it is handed', () => {
    const parsed: string[] = [];
    const dom: HtmlDom = {
      parse(html) {
        parsed.push(html);
        return new DOMParser().parseFromString(html, 'text/html');
      },
      serialize: (doc) => `<!doctype html>${doc.documentElement.outerHTML}`,
    };
    const out = sanitizeStaticHtml(PAGE, new Scrubber(), { dom });
    expect(parsed).toEqual([PAGE]);
    expect(out).not.toContain('<script');
    expect(out).not.toContain('value=');
    expect(out).not.toContain('<!-- c -->');
    expect(auditHtml(out, { dom })).toEqual([]);
    expect(parsed).toHaveLength(2);
  });

  it("parses with the browser's DOMParser when handed nothing", () => {
    const out = sanitizeStaticHtml(PAGE, new Scrubber());
    expect(out.startsWith('<!DOCTYPE html>') || out.startsWith('<!doctype html>')).toBe(true);
    expect(out).not.toContain('<script');
    expect(auditHtml(PAGE).map((f) => f.kind)).toEqual(expect.arrayContaining(['script', 'control-value']));
  });
});
