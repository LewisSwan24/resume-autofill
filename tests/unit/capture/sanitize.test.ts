// @vitest-environment node
// Everything captured from a real page passes through these functions before it stays on disk.
// All values below are fake; the test's job is to prove none of them survive.
import { describe, expect, it } from 'vitest';
import {
  Scrubber,
  auditHar,
  auditHtml,
  sanitizeHar,
  sanitizeStaticHtml,
  type HarFile,
} from '../../../scripts/capture/sanitize';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.c2lnbmF0dXJlLXZhbHVl';
const TOKEN = 'tok3n-Fake-Value-123456';

describe('Scrubber.text', () => {
  it('replaces e-mail addresses and keeps the same placeholder for the same address', () => {
    const s = new Scrubber();
    const a = s.text('mail jane.doe@corp.example now');
    const b = s.text('again JANE.DOE@corp.example');
    expect(a).not.toContain('jane.doe');
    expect(a).toContain('@example.invalid');
    expect(b.toLowerCase()).toContain(a.split(' ')[1]!.toLowerCase());
  });

  it('replaces url-encoded e-mail addresses', () => {
    expect(new Scrubber().text('/x?u=jane%40corp.example&a=1')).not.toContain('corp.example');
  });

  it('leaves retina asset names and package versions alone', () => {
    const s = new Scrubber();
    expect(s.text('url(logo@2x.png) core-js@3.2.1 flags@2x.webp')).toBe('url(logo@2x.png) core-js@3.2.1 flags@2x.webp');
  });

  it('replaces JWTs', () => {
    expect(new Scrubber().text(`{"t":"${JWT}"}`)).not.toContain('eyJhbGci');
  });

  it.each([
    [`"csrfToken":"${TOKEN}"`],
    [`csrf_token = '${TOKEN}'`],
    [`"X-CSRF-Token": "${TOKEN}"`],
    [`<meta name="csrf-token" content="${TOKEN}">`],
    [`<input name="authenticity_token" value="${TOKEN}">`],
    [`/api?access_token=${TOKEN}&x=1`],
    [`"sessionId":"${TOKEN}"`],
    [`JSESSIONID=${TOKEN};`],
  ])('replaces the secret in %s', (input) => {
    expect(new Scrubber().text(input)).not.toContain(TOKEN);
  });

  it('maps one secret to one placeholder across URL and body, so replay still matches', () => {
    const s = new Scrubber();
    const url = s.text(`/api?access_token=${TOKEN}`);
    const body = s.text(`{"access_token":"${TOKEN}"}`);
    const placeholder = /REDACTED-\d+/.exec(url)![0];
    expect(body).toContain(placeholder);
  });

  it('does not treat code that merely mentions a token as a secret', () => {
    const code = 'a={csrfToken:e.token,xsrfHeaderName:"X-XSRF-TOKEN"}';
    expect(new Scrubber().text(code)).toBe(code);
  });

  it('in keyed mode replaces phones only under a phone-like key and keeps numeric ids', () => {
    const s = new Scrubber();
    const out = s.text('{"phone":"0412 345 678","mobileNumber":"13812345678","id":19000000001,"q":"question_19000000001"}');
    expect(out).not.toContain('0412 345 678');
    expect(out).not.toContain('13812345678');
    expect(out).toContain('19000000001');
    expect(out).toContain('question_19000000001');
  });

  it.each([['+61 412 345 678'], ['0412 345 678'], ['13812345678'], ['+86 138 1234 5678']])(
    'in all mode replaces the phone %s',
    (phone) => {
      expect(new Scrubber().text(`Call ${phone} today`, { phones: 'all' })).not.toContain(phone);
    },
  );

  it('in all mode keeps ids glued to other characters, years and salary ranges', () => {
    const t = 'question_19000000001 2024-2026 $250K';
    expect(new Scrubber().text(t, { phones: 'all' })).toBe(t);
  });

  it('replaces listed terms case-insensitively, longest first', () => {
    const s = new Scrubber({ terms: ['Jane', 'Jane Doe', '12 Fake Street'] });
    const out = s.text('JANE DOE lives at 12 fake street; jane says hi');
    expect(out.toLowerCase()).not.toContain('jane');
    expect(out.toLowerCase()).not.toContain('fake street');
  });
});

describe('sanitizeStaticHtml', () => {
  const clean = (html: string, opts?: { css?: string; terms?: string[] }) =>
    sanitizeStaticHtml(html, new Scrubber({ terms: opts?.terms }), { css: opts?.css });

  it('removes everything that can execute or fetch', () => {
    const out = clean(`<!doctype html><html><head>
      <base href="https://x.example/"><script>steal()</script><noscript>n</noscript>
      <link rel="stylesheet" href="a.css"><link rel="preload" href="b.js">
      </head><body onload="x()"><!-- secret comment --><a onclick="y()" href="/a">a</a>
      <iframe srcdoc="<p>hi</p>" src="https://f.example/frame"></iframe></body></html>`);
    for (const gone of ['<script', 'steal', '<noscript', '<link', '<base', 'onload', 'onclick', 'secret comment', 'srcdoc']) {
      expect(out).not.toContain(gone);
    }
    expect(out).toContain('src="https://f.example/frame"');
  });

  it('clears control state but keeps option values, ids and names', () => {
    const out = clean(`<form>
      <input id="first_name" name="first" value="Jane">
      <input type="hidden" name="_token" value="${TOKEN}">
      <input type="radio" name="r" value="yes" checked>
      <input type="checkbox" name="c" value="on" checked>
      <input type="submit" value="Submit application">
      <select name="s"><option value="au" selected>Australia</option></select>
      <textarea name="t">my private note</textarea>
    </form>`);
    expect(out).toContain('id="first_name"');
    expect(out).not.toContain('Jane');
    expect(out).not.toContain(TOKEN);
    expect(out).toContain('value="yes"');
    expect(out).not.toMatch(/\bchecked\b/);
    expect(out).toContain('value="Submit application"');
    expect(out).toContain('value="au"');
    expect(out).toContain('Australia');
    expect(out).not.toMatch(/\bselected\b/);
    expect(out).not.toContain('my private note');
  });

  it('clears csrf meta tags and scrubs text, links and data attributes', () => {
    const out = clean(`<head><meta name="csrf-token" content="${TOKEN}"></head><body>
      <p>Contact jane@corp.example or +61 412 345 678</p>
      <a href="mailto:jane@corp.example">m</a><a href="tel:+61412345678">t</a>
      <div data-user='{"email":"jane@corp.example"}'></div></body>`);
    for (const gone of [TOKEN, 'jane@corp.example', '+61 412 345 678', '+61412345678']) expect(out).not.toContain(gone);
  });

  it('keeps form structure used by classification: labels, ids and numeric question ids', () => {
    const out = clean('<label for="question_19000000001">Do you require visa sponsorship?</label><input id="question_19000000001">');
    expect(out).toContain('question_19000000001');
    expect(out).toContain('Do you require visa sponsorship?');
  });

  it('scrubs inside declarative shadow roots', () => {
    const out = clean('<div><template shadowrootmode="open"><p>jane@corp.example</p><input value="Jane"><script>x()</script></template></div>');
    expect(out).toContain('shadowrootmode="open"');
    expect(out).not.toContain('jane@corp.example');
    expect(out).not.toContain('Jane');
    expect(out).not.toContain('x()');
  });

  it('inlines the collected CSS so visibility still works offline', () => {
    const out = clean('<html><head></head><body><p>a</p></body></html>', { css: '.hidden{display:none}' });
    expect(out).toMatch(/<style[^>]*>\.hidden\{display:none\}<\/style>/);
  });

  it('applies listed terms', () => {
    expect(clean('<p>Welcome back, Jane Doe</p>', { terms: ['Jane Doe'] })).not.toContain('Jane Doe');
  });

  it('passes its own audit', () => {
    const out = clean(`<meta name="csrf-token" content="${TOKEN}"><p>jane@corp.example ${JWT}</p><script>a</script>`);
    expect(auditHtml(out)).toEqual([]);
  });
});

function makeHar(): HarFile {
  return {
    log: {
      entries: [
        {
          request: {
            method: 'POST',
            url: `https://x.example/api?access_token=${TOKEN}&u=jane%40corp.example`,
            headers: [
              { name: 'Cookie', value: 'sid=secret-cookie' },
              { name: 'Authorization', value: `Bearer ${JWT}` },
              { name: 'x-csrf-token', value: TOKEN },
              { name: 'Accept', value: 'application/json' },
            ],
            cookies: [{ name: 'sid', value: 'secret-cookie' }],
            queryString: [{ name: 'access_token', value: TOKEN }],
            postData: { mimeType: 'application/json', text: '{"email":"jane@corp.example"}' },
          },
          response: {
            status: 200,
            headers: [
              { name: 'Set-Cookie', value: 'sid=secret-cookie; HttpOnly' },
              { name: 'content-length', value: '10' },
              { name: 'content-encoding', value: 'gzip' },
              { name: 'content-type', value: 'application/json' },
              { name: 'location', value: `/next?access_token=${TOKEN}` },
            ],
            cookies: [{ name: 'sid', value: 'secret-cookie' }],
            content: { mimeType: 'application/json', text: `{"phone":"0412 345 678","csrfToken":"${TOKEN}","id":19000000001}`, size: 10 },
          },
        },
        {
          request: { method: 'GET', url: 'https://x.example/app.js', headers: [], cookies: [], queryString: [] },
          response: {
            status: 200,
            headers: [{ name: 'content-type', value: 'text/javascript' }],
            cookies: [],
            content: { mimeType: 'text/javascript', _file: 'js-sidecar', size: 5 },
          },
        },
        {
          request: { method: 'GET', url: 'https://x.example/logo.png', headers: [], cookies: [], queryString: [] },
          response: {
            status: 200,
            headers: [{ name: 'content-type', value: 'image/png' }],
            cookies: [],
            content: { mimeType: 'image/png', _file: 'png-sidecar', size: 5 },
          },
        },
        {
          request: { method: 'GET', url: 'https://x.example/inline', headers: [], cookies: [], queryString: [] },
          response: {
            status: 200,
            headers: [{ name: 'content-type', value: 'text/html' }],
            cookies: [],
            content: { mimeType: 'text/html', text: btoa('<p>jane@corp.example</p>'), encoding: 'base64', size: 5 },
          },
        },
      ],
    },
  };
}

function sidecarStore() {
  const files: Record<string, string> = {
    'js-sidecar': `const a="jane@corp.example";const id=19000000001;const c={"csrfToken":"${TOKEN}"};`,
    'png-sidecar': 'jane@corp.example-is-not-text-here',
  };
  return {
    files,
    io: {
      read: (name: string) => files[name] ?? null,
      write: (name: string, text: string) => {
        files[name] = text;
      },
    },
  };
}

describe('sanitizeHar', () => {
  it('drops sensitive headers and cookie arrays on both sides', () => {
    const har = makeHar();
    sanitizeHar(har, new Scrubber(), sidecarStore().io);
    const [e] = har.log.entries;
    const req = e!.request.headers.map((h) => h.name.toLowerCase());
    const res = e!.response.headers.map((h) => h.name.toLowerCase());
    expect(req).toEqual(['accept']);
    expect(res).not.toContain('set-cookie');
    expect(e!.request.cookies).toEqual([]);
    expect(e!.response.cookies).toEqual([]);
  });

  it('drops content-length and content-encoding, since bodies change size and are stored decoded', () => {
    const har = makeHar();
    sanitizeHar(har, new Scrubber(), sidecarStore().io);
    const res = har.log.entries[0]!.response.headers.map((h) => h.name.toLowerCase());
    expect(res).not.toContain('content-length');
    expect(res).not.toContain('content-encoding');
  });

  it('scrubs URLs, query arrays, post data, redirects and inline bodies consistently', () => {
    const har = makeHar();
    sanitizeHar(har, new Scrubber(), sidecarStore().io);
    const e = har.log.entries[0]!;
    const blob = JSON.stringify(e);
    for (const gone of [TOKEN, 'jane', '0412 345 678', 'secret-cookie', JWT]) expect(blob).not.toContain(gone);
    expect(e.response.content.text).toContain('19000000001');
    const placeholder = /REDACTED-\d+/.exec(e.request.url)![0];
    expect(e.request.queryString[0]!.value).toBe(placeholder);
    expect(e.response.content.text).toContain(placeholder);
  });

  it('rewrites text sidecars and leaves binary sidecars untouched', () => {
    const har = makeHar();
    const store = sidecarStore();
    sanitizeHar(har, new Scrubber(), store.io);
    expect(store.files['js-sidecar']).not.toContain('jane@corp.example');
    expect(store.files['js-sidecar']).not.toContain(TOKEN);
    expect(store.files['js-sidecar']).toContain('19000000001');
    expect(store.files['png-sidecar']).toBe('jane@corp.example-is-not-text-here');
  });

  it('decodes inline base64 text bodies before scrubbing', () => {
    const har = makeHar();
    sanitizeHar(har, new Scrubber(), sidecarStore().io);
    const c = har.log.entries[3]!.response.content;
    expect(c.encoding).toBeUndefined();
    expect(c.text).toContain('<p>');
    expect(c.text).not.toContain('jane');
  });

  it('scrubs visible phones in HTML bodies but keeps ids and code inside scripts', () => {
    const page =
      '<p>Call 0412 345 678</p><a href="/jobs/19000000001">job</a>' +
      '<script>var job={"id":"19000000001","phone":"0412 000 111"};</script><p>or +61 412 345 678</p>';
    const har = makeHar();
    har.log.entries[3]!.response.content = { mimeType: 'text/html', text: page };
    const store = sidecarStore();
    store.files['js-sidecar'] = page;
    har.log.entries[1]!.response.content = { mimeType: 'text/html; charset=utf-8', _file: 'js-sidecar' };
    sanitizeHar(har, new Scrubber(), store.io);
    for (const out of [har.log.entries[3]!.response.content.text!, store.files['js-sidecar']!]) {
      expect(out).not.toContain('0412 345 678');
      expect(out).not.toContain('+61 412 345 678');
      expect(out).not.toContain('0412 000 111');
      expect(out).toContain('/jobs/19000000001');
      expect(out).toContain('"id":"19000000001"');
    }
  });

  it('empties integrity hashes, because scrubbing changes the bytes they vouch for', () => {
    const har = makeHar();
    har.log.entries[3]!.response.content = {
      mimeType: 'text/html',
      text: '<script src="/a.js" integrity="sha384-abc+/DEF123=" crossorigin></script>',
    };
    har.log.entries[0]!.response.content.text = '{"a.js":{"integrity":"sha512-abc+/DEF123="}}';
    const store = sidecarStore();
    store.files['js-sidecar'] = 's.integrity="sha256-abc+/DEF123=";';
    sanitizeHar(har, new Scrubber(), store.io);
    expect(har.log.entries[3]!.response.content.text).toContain('integrity=""');
    expect(har.log.entries[0]!.response.content.text).toContain('"integrity":""');
    expect(store.files['js-sidecar']).toBe('s.integrity="";');
  });

  it('leaves bare digits in JSON and scripts alone', () => {
    const har = makeHar();
    har.log.entries[0]!.response.content.text = '{"id":"19000000001","ref":"13812345678"}';
    sanitizeHar(har, new Scrubber(), sidecarStore().io);
    expect(har.log.entries[0]!.response.content.text).toContain('"ref":"13812345678"');
  });

  it('applies listed terms to every text part', () => {
    const har = makeHar();
    har.log.entries[0]!.response.content.text = '{"name":"Jane Doe"}';
    const store = sidecarStore();
    store.files['js-sidecar'] = 'const u="Jane Doe"';
    sanitizeHar(har, new Scrubber({ terms: ['Jane Doe'] }), store.io);
    expect(JSON.stringify(har)).not.toContain('Jane Doe');
    expect(store.files['js-sidecar']).not.toContain('Jane Doe');
  });

  it('passes its own audit, terms included', () => {
    const har = makeHar();
    const store = sidecarStore();
    sanitizeHar(har, new Scrubber({ terms: ['Jane Doe'] }), store.io);
    expect(auditHar(har, store.io, { terms: ['Jane Doe'] })).toEqual([]);
  });
});

describe('audit', () => {
  it('reports each leak in an unsanitized HAR by structure, not by line count', () => {
    const store = sidecarStore();
    const findings = auditHar(makeHar(), store.io).map((f) => f.kind);
    for (const kind of ['sensitive-header', 'cookie-array', 'email', 'secret']) expect(findings).toContain(kind);
  });

  it('reports a visible phone left in an HTML body', () => {
    const har = makeHar();
    const store = sidecarStore();
    sanitizeHar(har, new Scrubber(), store.io);
    har.log.entries[3]!.response.content = { mimeType: 'text/html', text: '<p>0412 345 678</p>' };
    expect(auditHar(har, store.io).map((f) => f.kind)).toContain('phone');
  });

  it('reports a leak that only exists in a sidecar', () => {
    const har = makeHar();
    const store = sidecarStore();
    sanitizeHar(har, new Scrubber(), store.io);
    store.files['js-sidecar'] = 'const a="leak@corp.example"';
    expect(auditHar(har, store.io).map((f) => f.kind)).toContain('email');
  });

  it('reports a listed term and an unreadable text sidecar', () => {
    const har = makeHar();
    const store = sidecarStore();
    sanitizeHar(har, new Scrubber(), store.io);
    har.log.entries[0]!.response.content.text = 'Jane Doe';
    delete store.files['js-sidecar'];
    const kinds = auditHar(har, store.io, { terms: ['Jane Doe'] }).map((f) => f.kind);
    expect(kinds).toContain('term');
    expect(kinds).toContain('unreadable');
  });

  it('reports scripts, values and secrets left in static HTML', () => {
    const kinds = auditHtml(
      `<script>a</script><input value="Jane"><input type="hidden" value="x"><meta name="csrf-token" content="${TOKEN}"><p>a@corp.example</p>`,
    ).map((f) => f.kind);
    for (const kind of ['script', 'control-value', 'secret', 'email']) expect(kinds).toContain(kind);
  });
});
