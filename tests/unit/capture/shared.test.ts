// The capture code the extension's recorder and the command-line tool share. The extension cannot load jsdom, so the
// shared code parses HTML with whatever the caller hands it, and with the browser's own DOMParser when given nothing.
// Serialising a page needs a real browser (getHTML, adopted style sheets): tests/drivers covers it.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Scrubber, auditHtml, sanitizeStaticHtml, type HtmlDom } from '../../../src/capture/sanitize';

const PAGE = '<!doctype html><html><head><script>x()</script></head><body><input value="a@b.example.com"><!-- c --></body></html>';

describe('shared capture code', () => {
  it('imports nothing that only runs in Node', () => {
    for (const file of ['src/capture/sanitize.ts', 'src/capture/serialize.ts', 'src/capture/har.ts']) {
      expect(readFileSync(file, 'utf8')).not.toMatch(/from ['"](?:jsdom|node:[\w/]+)['"]/);
      expect(readFileSync(file, 'utf8'), file).not.toMatch(/\bBuffer\.|\bprocess\.|\brequire\(/);
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

  it('reads and writes a base64 body as UTF-8 without Node', async () => {
    const { auditHar, sanitizeHar } = await import('../../../src/capture/sanitize');
    const io = { read: () => null, write: () => {}, remove: () => {} };
    const text = 'Écrivez à jane@corp.example';
    const b64 = btoa(String.fromCharCode(...new TextEncoder().encode(text)));
    const har = {
      log: {
        entries: [
          {
            request: { method: 'GET', url: 'https://x.example.com/', headers: [], cookies: [], queryString: [] },
            response: { status: 200, headers: [], cookies: [], content: { mimeType: 'text/plain', text: b64, encoding: 'base64' } },
          },
        ],
      },
    };
    expect(auditHar(har, io).map((f) => f.kind)).toEqual(['email']);
    sanitizeHar(har, new Scrubber(), io);
    const content = har.log.entries[0]!.response.content as { text: string; encoding?: string; size?: number };
    expect(content.text).toBe('Écrivez à redacted-1@example.invalid');
    expect(content.encoding).toBeUndefined();
    expect(content.size).toBe(new TextEncoder().encode(content.text).length);
  });

  it("parses with the browser's DOMParser when handed nothing", () => {
    const out = sanitizeStaticHtml(PAGE, new Scrubber());
    expect(out.startsWith('<!DOCTYPE html>') || out.startsWith('<!doctype html>')).toBe(true);
    expect(out).not.toContain('<script');
    expect(auditHtml(PAGE).map((f) => f.kind)).toEqual(expect.arrayContaining(['script', 'control-value']));
  });
});
