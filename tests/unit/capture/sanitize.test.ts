// Everything captured from a real page passes through these functions before it stays on disk.
// All values below are fake; the test's job is to prove none of them survive.
import { describe, expect, it } from 'vitest';
import {
  Scrubber,
  auditHar,
  auditHtml,
  auditStorage,
  sanitizeHar,
  resumeTerms,
  sanitizeStaticHtml,
  sanitizeStorage,
  type HarFile,
} from '../../../src/capture/sanitize';
import { createSampleProfile } from '../../../src/schema/samples';

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

function sidecarStore(extra: Record<string, string> = {}) {
  const files: Record<string, string> = {
    ...extra,
    'js-sidecar': `const a="jane@corp.example";const id=19000000001;const c={"csrfToken":"${TOKEN}"};`,
    'png-sidecar': 'jane@corp.example-is-not-text-here',
  };
  return {
    files,
    io: {
      read: (name: string) => files[name] ?? null,
      remove: (name: string) => {
        delete files[name];
      },
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

  it("drops a sign-in an app sends in headers of its own naming, and the audit reports one left in", () => {
    const signIn = ['Ora-Irc-Access-Code', 'X-Session-Id', 'X-Refresh-Token', 'X-Client-Secret', 'X-Apikey', 'x-access_code'];
    const kept = ['accept', 'Content-Type', 'Ora-Irc-Language', 'X-Requested-With'];
    const withHeaders = () => {
      const har = makeHar();
      har.log.entries[0]!.request.headers = [...signIn, ...kept].map((name) => ({ name, value: '1f2e3d4c-5b6a-4789-8abc-def012345678' }));
      return har;
    };
    const audited = auditHar(withHeaders(), sidecarStore().io).filter((f) => f.kind === 'sensitive-header').map((f) => f.sample);
    expect(audited).toEqual(expect.arrayContaining(signIn.map((n) => n.toLowerCase())));
    const har = withHeaders();
    sanitizeHar(har, new Scrubber(), sidecarStore().io);
    expect(har.log.entries[0]!.request.headers.map((h) => h.name)).toEqual(kept);
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

  it('drops a request whose sent body cannot be read, as telemetry often is', () => {
    const har = makeHar();
    const store = sidecarStore();
    const count = har.log.entries.length;
    const binary = { ...har.log.entries[0]! };
    binary.request = { ...binary.request, method: 'POST', postData: { mimeType: 'text/plain', _file: 'gone-sidecar' } };
    har.log.entries.push(binary);
    sanitizeHar(har, new Scrubber(), store.io);
    expect(har.log.entries).toHaveLength(count);
    expect(auditHar(har, store.io).filter((f) => f.kind === 'unreadable')).toEqual([]);
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

describe('sanitizeHar, prefetched files', () => {
  const entry = (url: string, purpose: string | null, file: string, size: number) => ({
    request: {
      method: 'GET',
      url,
      headers: purpose ? [{ name: 'sec-purpose', value: purpose }] : [],
      cookies: [],
      queryString: [],
    },
    response: {
      status: 200,
      headers: [],
      cookies: [],
      content: { mimeType: 'application/javascript', _file: file, size },
    },
  });
  const CHUNK = 'https://cdn.example/chunk.js';
  const OTHER = 'https://cdn.example/other.js';

  // A prefetch is recorded with an empty body. Replaying it serves an empty script and the page hangs.
  it('forgets a prefetch recorded with no body, so replay serves the real load', () => {
    const har = { log: { entries: [entry(CHUNK, 'prefetch', 'empty.js', 0), entry(CHUNK, null, 'real.js', 10)] } };
    const store = sidecarStore({ 'empty.js': '', 'real.js': 'load(1234)' });
    sanitizeHar(har, new Scrubber(), store.io);
    expect(har.log.entries.map((e) => e.response.content._file)).toEqual(['real.js']);
    expect(store.files).not.toHaveProperty(['empty.js']);
  });

  // Nothing is better than an empty script: an aborted load fails where a test can see it.
  it('forgets a prefetch that was never really loaded', () => {
    const har = { log: { entries: [entry(OTHER, 'prefetch', 'empty.js', 0)] } };
    sanitizeHar(har, new Scrubber(), sidecarStore({ 'empty.js': '' }).io);
    expect(har.log.entries).toEqual([]);
  });

  it('keeps a prefetch that did record its body', () => {
    const har = { log: { entries: [entry(CHUNK, 'prefetch', 'real.js', 10)] } };
    sanitizeHar(har, new Scrubber(), sidecarStore({ 'real.js': 'load(1234)' }).io);
    expect(har.log.entries).toHaveLength(1);
  });

  it('keeps an ordinary response that really is empty, and the file it shares', () => {
    const har = { log: { entries: [entry(CHUNK, 'prefetch', 'empty.js', 0), entry(OTHER, null, 'empty.js', 0)] } };
    const store = sidecarStore({ 'empty.js': '' });
    sanitizeHar(har, new Scrubber(), store.io);
    expect(har.log.entries.map((e) => e.request.url)).toEqual([OTHER]);
    expect(store.files).toHaveProperty(['empty.js']);
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

// Chinese portals. Every value is invented: the ID numbers carry a valid check digit on a made-up region.
const CN_MOBILE = '13900001111';
const CN_ID = '123456199001011233';
const CN_ID_BAD_CHECK = '123456199001011234';
const FAKE_RESUME = {
  id: 'r1',
  locale: 'zh-CN',
  basics: { familyName: '甲', givenName: '乙丙', englishName: 'Fakey Person', idNumber: CN_ID },
  contact: {
    email: 'fake.person@example.cn',
    phone: CN_MOBILE,
    wechat: 'fake_wechat_01',
    address: { city: '北京', street: '虚构路 1 号' },
  },
  education: [{ school: '虚构大学', schoolEn: 'Fakeston University', degree: 'bachelor', major: 'Computer Science' }],
  work: [{ company: '虚构科技有限公司', position: 'Engineer' }],
};

describe('Chinese personal data', () => {
  it('replaces a mainland mobile and an e-mail written next to Chinese text', () => {
    const out = new Scrubber({ cn: true }).text(`手机：${CN_MOBILE}，邮箱：fake.person@example.cn。`, { phones: 'all' });
    expect(out).not.toContain(CN_MOBILE);
    expect(out).not.toContain('fake.person');
  });

  it('in Chinese mode replaces a mobile that is a whole string, a query value or a bare number, whatever its key', () => {
    const s = new Scrubber({ cn: true });
    const json = s.text(`{"ref":"${CN_MOBILE}","b":"+86 ${CN_MOBILE}","n":19000000001}`);
    expect(json).not.toContain(CN_MOBILE);
    expect(json).not.toContain('19000000001');
    // The placeholder is digits only, so a JSON number stays a number.
    expect(typeof JSON.parse(json).n).toBe('number');
    expect(s.text(`/api?m=${CN_MOBILE}&x=1`)).not.toContain(CN_MOBILE);
    expect(s.text(CN_MOBILE)).not.toContain(CN_MOBILE);
  });

  it('replaces an ID card number with a valid check digit, as text, string or bare number', () => {
    const s = new Scrubber({ cn: true });
    expect(s.text(`身份证号：${CN_ID}`, { phones: 'all' })).not.toContain(CN_ID);
    const json = s.text(`{"a":"${CN_ID}","b":${CN_ID}}`);
    expect(json).not.toContain(CN_ID);
    expect(() => JSON.parse(json)).not.toThrow();
  });

  it('keeps numbers that only look like an ID card: bad check digit, no date inside, or part of a longer number', () => {
    const s = new Scrubber({ cn: true });
    const t = `{"order":"${CN_ID_BAD_CHECK}","ts":"123456123456789012","long":"9${CN_ID}","longer":${CN_ID}5}`;
    expect(s.text(t)).toBe(t);
  });

  it('leaves pages outside Chinese mode as they were', () => {
    const t = `{"ref":"${CN_MOBILE}","id":"${CN_ID}"}`;
    expect(new Scrubber().text(t)).toBe(t);
  });

  it('takes names, schools, addresses and contact details from a resume as terms', () => {
    const terms = resumeTerms(FAKE_RESUME);
    for (const v of [
      '甲乙丙',
      'Fakey Person',
      CN_ID,
      'fake.person@example.cn',
      CN_MOBILE,
      'fake_wechat_01',
      '虚构路 1 号',
      '虚构大学',
      'Fakeston University',
      '虚构科技有限公司',
    ]) {
      expect(terms).toContain(v);
    }
    // Shared vocabulary would wipe the page's own options: cities, degrees, majors, titles, one-letter names.
    for (const v of ['北京', 'bachelor', 'Computer Science', 'Engineer', '甲', 'zh-CN', 'r1']) expect(terms).not.toContain(v);
  });

  it('scrubs every resume value from static HTML and a HAR, and the audit agrees', () => {
    const terms = resumeTerms(FAKE_RESUME);
    const scrub = new Scrubber({ terms, cn: true });
    const html = sanitizeStaticHtml(
      `<p>欢迎 甲乙丙，虚构大学，虚构路 1 号</p><div data-u="${CN_MOBILE}" data-id="${CN_ID}">Fakeston University</div>`,
      scrub,
    );
    for (const v of ['甲乙丙', '虚构大学', '虚构路 1 号', CN_MOBILE, CN_ID, 'Fakeston']) expect(html).not.toContain(v);
    expect(auditHtml(html, { terms, cn: true })).toEqual([]);

    const har = makeHar();
    har.log.entries[0]!.response.content.text = `{"u":{"n":"甲乙丙","x":"${CN_MOBILE}","card":${CN_ID},"s":"虚构大学"}}`;
    har.log.entries[0]!.request.url = `https://x.example/api?m=${CN_MOBILE}&e=fake.person%40example.cn`;
    const store = sidecarStore();
    sanitizeHar(har, scrub, store.io);
    const all = JSON.stringify(har) + JSON.stringify(store.files);
    for (const v of ['甲乙丙', '虚构大学', CN_MOBILE, CN_ID, 'fake.person']) expect(all).not.toContain(v);
    expect(auditHar(har, store.io, { terms, cn: true })).toEqual([]);
  });

  it('the audit reports a mobile and an ID card left in a body', () => {
    const har = makeHar();
    har.log.entries[0]!.response.content.text = `{"x":"${CN_MOBILE}","y":"${CN_ID}"}`;
    const kinds = auditHar(har, sidecarStore().io, { cn: true }).map((f) => f.kind);
    expect(kinds).toContain('phone');
    expect(kinds).toContain('id-card');
  });
});

// A Latin-script name split into its parts gives short words that live inside markup, CSS and code.
describe('terms in Latin script', () => {
  const LATIN = { basics: { familyName: 'Min', givenName: 'Fakeyuan', preferredName: 'Max', englishName: 'Ax' } };
  const PAGE = '<link rel="stylesheet"><style>.x{min-width:0;display:inline;line-height:1}</style><p>Fakeyuan Min, MAX online</p><script>Math.max(a,b);minimal()</script>';

  it('makes a short Latin name part a term only inside a full name', () => {
    const terms = resumeTerms(LATIN);
    expect(terms).toContain('Fakeyuan Min');
    expect(terms).toContain('Min Fakeyuan');
    for (const v of ['Min', 'Max', 'Ax']) expect(terms).not.toContain(v);
  });

  it('replaces a Latin term only as a whole word, so markup, CSS and code survive', () => {
    const s = new Scrubber({ terms: [...resumeTerms(LATIN), 'Lin'], cn: true });
    expect(s.text(PAGE)).toBe(PAGE.replace('Fakeyuan Min', 'REDACTED-TERM'));
  });

  it('still replaces a Latin term written straight after Chinese text', () => {
    expect(new Scrubber({ terms: ['Fakeyuan Min'] }).text('欢迎Fakeyuan Min！')).toBe('欢迎REDACTED-TERM！');
  });
});

describe('terms made of digits', () => {
  it('replaces a number only where it is the whole run of digits', () => {
    const s = new Scrubber({ terms: ['123456'] });
    expect(s.text('qq 123456; const k=1712345678, h="ab123456cd", v=1234567')).toBe(
      'qq 900000; const k=1712345678, h="ab900000cd", v=1234567',
    );
  });

  it('keeps an audit quiet about a digit term inside a longer number', () => {
    const har = makeHar();
    har.log.entries[0]!.response.content.text = '{"k":1712345678}';
    const kinds = auditHar(har, sidecarStore().io, { terms: ['345678'] }).map((f) => f.kind);
    expect(kinds).not.toContain('term');
  });
});

// Every part of the resume schema that names or locates a person, not only the applicant's own basics and contact.
describe('resume terms across the whole schema', () => {
  const RESUME = {
    basics: {
      familyName: '甲',
      givenName: '乙丙',
      birthDate: '1999-04-07',
      nativePlace: { province: '虚构省', city: '甲市', district: '乙区' },
      studentOrigin: { province: '虚构省', city: '甲市' },
      household: { province: '虚构省', city: '丙市', district: '丁区' },
      currentLocation: { country: '中国', province: '另一省', city: '戊市', district: '己区' },
    },
    contact: { address: { province: '虚构省', city: '甲市', district: '乙区', street: '虚构路 1 号' } },
    education: [{ school: '虚构大学', city: '甲市', thesis: '一种虚构方法的研究', major: '计算机科学' }],
    work: [{ company: '虚构科技有限公司', position: '工程师', description: '负责虚构系统' }],
    projects: [{ name: 'Resume tool', link: 'https://example.test/fake-project' }],
    campus: [{ organization: '学生会' }],
    awards: [{ name: '一等奖学金', issuer: '虚构大学' }],
    languages: [{ language: 'English', certificate: 'IELTS', score: '7.5' }],
    certificates: [{ name: 'CET-6', number: 'CERT-2020-778899' }],
    skills: [{ name: 'Python' }],
    family: [{ name: '丁戊', relationship: 'father', employer: '虚构机械有限公司', position: '工程师', phone: '13700003333' }],
    emergencyContact: { name: '己庚', phone: '13700004444' },
    referees: [{ name: 'Dr Fakey Referee', title: 'Lecturer', company: 'Example Pty Ltd', email: 'referee@example.test' }],
  };

  it('takes relatives, referees, employers, certificate numbers, project links, birth date and home region', () => {
    const terms = resumeTerms(RESUME);
    for (const v of [
      '丁戊',
      '己庚',
      'Dr Fakey Referee',
      'Fakey Referee',
      '虚构机械有限公司',
      'Example Pty Ltd',
      'referee@example.test',
      '13700003333',
      '13700004444',
      'CERT-2020-778899',
      'https://example.test/fake-project',
      '一种虚构方法的研究',
      '1999-04-07',
      '1999/04/07',
      '1999.04.07',
      '19990407',
      '1999年4月7日',
      '1999年04月07日',
      '虚构省甲市乙区',
      '甲市乙区',
      '虚构省甲市',
      '虚构省丙市丁区',
      '另一省戊市己区',
      '戊市己区',
    ]) {
      expect(terms).toContain(v);
    }
    // A bare city, district or province is also an option label on the page; so are skills, awards and titles.
    for (const v of ['甲市', '乙区', '虚构省', '中国', 'Python', 'CET-6', 'English', 'IELTS', '一等奖学金', 'Resume tool', 'Lecturer', '学生会']) {
      expect(terms).not.toContain(v);
    }
  });

  it('scrubs a profile answer that holds them, and the audit agrees', () => {
    const terms = resumeTerms(RESUME);
    const body = '{"emergencyName":"己庚","nativePlace":"虚构省甲市乙区","birth":"1999-04-07","father":"丁戊","cert":"CERT-2020-778899"}';
    const out = new Scrubber({ terms, cn: true }).text(body);
    for (const v of ['己庚', '甲市乙区', '1999-04-07', '丁戊', 'CERT-2020']) expect(out).not.toContain(v);
    expect(() => JSON.parse(out)).not.toThrow();
    const har = makeHar();
    har.log.entries[0]!.response.content.text = body;
    expect(auditHar(har, sidecarStore().io, { terms }).filter((f) => f.kind === 'term').length).toBeGreaterThan(0);
  });

  it('covers the names, employers and birth date of the built-in sample profile', () => {
    const profile = createSampleProfile();
    const terms = resumeTerms(profile);
    for (const r of profile.resumes) {
      for (const f of r.family) {
        expect(terms).toContain(f.name);
        if (f.employer) expect(terms).toContain(f.employer);
      }
      if (r.emergencyContact.name) expect(terms).toContain(r.emergencyContact.name);
      for (const ref of r.referees) expect(terms).toContain(ref.name);
      if (r.basics.birthDate) expect(terms).toContain(r.basics.birthDate);
    }
  });
});

describe('mainland mobile placeholders', () => {
  it('are eleven digits that url-encoding leaves alone and that never look like a mobile again', () => {
    const s = new Scrubber({ cn: true });
    const seen = new Set<string>();
    for (let i = 0; i < 30; i++) {
      const mobile = `1390000${String(1000 + i)}`;
      const out = s.text(`{"m":"${mobile}"}`);
      const placeholder = /"m":"(.*)"/.exec(out)![1]!;
      expect(placeholder).toMatch(/^\d{11}$/);
      expect(placeholder).not.toMatch(/1[3-9]\d{9}/);
      expect(encodeURIComponent(placeholder)).toBe(placeholder);
      expect(s.text(`{"m":"${placeholder}"}`)).toBe(`{"m":"${placeholder}"}`);
      seen.add(placeholder);
    }
    expect(seen.size).toBe(30);
  });

  it('are the same in a body, a query value and under a phone key', () => {
    const s = new Scrubber({ cn: true });
    const body = s.text(`{"ref":"${CN_MOBILE}","phone":"${CN_MOBILE}","mobile":"0086 ${CN_MOBILE}"}`);
    const url = s.text(`/api?m=${CN_MOBILE}`);
    const placeholder = /m=(\d+)/.exec(url)![1]!;
    expect(body).toBe(`{"ref":"${placeholder}","phone":"${placeholder}","mobile":"0086 ${placeholder}"}`);
  });
});

// The forms a mainland mobile or an ID number takes on a real portal: encoded, prefixed, grouped, in a list,
// behind tel: or glued to a key. Each must be scrubbed, and the audit must see each one when it is not.
describe('mainland mobiles and ID numbers in other shapes', () => {
  const OTHER = '13700002222';
  const LEAKS: [string, string][] = [
    ['an encoded +86 in a query', `https://x.example.cn/api?acct=%2B86${CN_MOBILE}&y=1`],
    ['an encoded +86 and a + for the space', `acct=%2B86+${CN_MOBILE}`],
    ['an encoded +86 and %20', `acct=%2B86%20${CN_MOBILE}`],
    ['an encoded delimiter', `list=a%2C${CN_MOBILE}`],
    ['three groups with spaces', '{"a":"139 0000 1111"}'],
    ['three groups with dashes', '{"a":"139-0000-1111"}'],
    ['+86 and dashes', '{"a":"+86-139-0000-1111"}'],
    ['a 0086 prefix', `{"a":"0086 ${CN_MOBILE}"}`],
    ['a bare 86 prefix', `{"a":"86${CN_MOBILE}"}`],
    ['a semicolon after it', `x=${CN_MOBILE};y`],
    ['a list', `"${CN_MOBILE},${OTHER}"`],
    ['a tel: link in a string', `{"href":"tel:${CN_MOBILE}"}`],
    ['a tel: link in a script', `location.href='tel:+86${CN_MOBILE}'`],
    ['a JSON escape before it', `{"q":"m\\u003d${CN_MOBILE}"}`],
    ['a key glued to it', `{"k":"mobile_${CN_MOBILE}"}`],
    ['a bare number', `{"n":${CN_MOBILE}}`],
    ['a dashed ID number', '{"a":"123456-19900101-1233"}'],
    ['an ID number in four groups', '{"a":"123456 1990 0101 1233"}'],
    ['an ID number glued to a key', `idcard_${CN_ID}`],
    ['an ID number after a %XX escape', `q=a%3D${CN_ID}`],
  ];
  const digits = (s: string): string => s.replace(/\D/g, '');
  const leaked = (s: string): boolean => [CN_MOBILE, OTHER, CN_ID.slice(0, 17)].some((v) => digits(s).includes(v));

  it.each(LEAKS)('scrubs %s', (_label, input) => {
    expect(leaked(input)).toBe(true);
    const out = new Scrubber({ cn: true }).text(input);
    expect(leaked(out), out).toBe(false);
  });

  const audit = (text: string) => {
    const har = makeHar();
    har.log.entries = [har.log.entries[0]!];
    har.log.entries[0]!.request = { method: 'GET', url: 'https://x.example/api', headers: [], cookies: [], queryString: [] };
    har.log.entries[0]!.response = { status: 200, headers: [], cookies: [], content: { mimeType: 'text/plain', text } };
    return auditHar(har, sidecarStore().io, { cn: true }).map((f) => f.kind);
  };

  it.each(LEAKS)('the audit reports %s left in a body, and nothing once it is scrubbed', (_label, input) => {
    expect(audit(input).some((k) => k === 'phone' || k === 'id-card')).toBe(true);
    expect(audit(new Scrubber({ cn: true }).text(input))).toEqual([]);
  });

  it('leaves numbers that only share digits with a mobile: timestamps, longer runs and grouped path data', () => {
    const t = '{"ts":1712345678901,"big":"139000011112","n":"1390000111"}<path d="M139 0000 1111 L2 3"/><i data-v="139 0000 1111 22">';
    expect(new Scrubber({ cn: true }).text(t)).toBe(t);
    expect(audit(t)).toEqual([]);
  });
});

describe('pages built with Next.js', () => {
  // The page's data travels inside the HTML as JSON strings pushed onto self.__next_f. A text row in it says
  // its own length in UTF-8 bytes ("1:T17,"), so a placeholder longer or shorter than what it replaces
  // breaks the stream, and React shows "This page couldn't load" on replay.
  const BS = String.fromCharCode(92);
  /** A JSON escape as the page's script holds it: a backslash, u, four hex digits. */
  const u = (ch: string): string => `${BS}u${ch.charCodeAt(0).toString(16).padStart(4, '0')}`;
  const OPEN = 'self.__next_f.push([1,';
  const push = (chunk: string): string =>
    `<script>${OPEN}${JSON.stringify(chunk).replace(/</g, u('<')).replace(/>/g, u('>'))}])</script>`;
  const stream = (html: string): string => {
    let out = '';
    for (let at = html.indexOf(OPEN); at >= 0; at = html.indexOf(OPEN, at + 1)) {
      const start = at + OPEN.length;
      out += JSON.parse(html.slice(start, html.indexOf('])</script>', start))) as string;
    }
    return out;
  };
  const bytes = (s: string): number => new TextEncoder().encode(s).length;

  it('keeps an escape that stands right before an e-mail address', () => {
    const out = new Scrubber().text(`${u('<')}a href="mailto:x"${u('>')}jane@corp.example${u('<')}/a${u('>')}`);
    expect(out).toContain(`${u('>')}redacted-1@example.invalid${u('<')}/a`);
    expect(new Scrubber().text(`line${BS}njane@corp.example`)).toBe(`line${BS}nredacted-1@example.invalid`);
    expect(new Scrubber().text('q=%3Cjane%40corp.example%3E')).toBe('q=%3Credacted-1@example.invalid%3E');
  });

  it('finds an address after any escape, and the audit finds what a scrub would have missed', () => {
    for (const before of [`${BS}x3e`, `${BS}${BS}`, `${BS}v`, '%2B']) {
      expect(new Scrubber().text(`a${before}jane@corp.example`)).not.toContain('jane@corp');
      expect(auditHtml(`<p>a${before}jane@corp.example</p>`).map((f) => f.kind)).toContain('email');
    }
    expect(new Scrubber().text(`a${BS}x3ejane@corp.example`)).toBe(`a${BS}x3eredacted-1@example.invalid`);
    expect(auditHtml(`<p>a${BS}x3eredacted-1@example.invalid ${u('>')}redacted-2@example.invalid</p>`)).toEqual([]);
  });

  it('takes no escape for the name in an address: a page may show only the part from the @ on', () => {
    // Personio's footer links "impressum" and "@1komma5grad.com" apart; in page script the second reads >@...
    const text = `"${u('>')}impressum${u('<')}/a${u('>')}${u('<')}a${u('>')}@corp.example${u('<')}/a${u('>')}"`;
    expect(new Scrubber().text(text)).toBe(text);
    expect(auditHtml(`<script>var s = ${text}</script>`).filter((f) => f.kind === 'email')).toEqual([]);
    expect(new Scrubber().text(`${u('>')}jane@corp.example`)).toBe(`${u('>')}redacted-1@example.invalid`);
  });

  it('still takes an escape that spells a letter of the name as part of the address', () => {
    // %61, \x6a and j are a, j and j: "a@corp.example" written escaped, not a bare domain.
    for (const escaped of ['%61@corp.example', `${BS}x6a@corp.example`, `${BS}u006a@corp.example`]) {
      const text = `see ${escaped} now`;
      expect(new Scrubber().text(text), escaped).not.toContain('@corp.example');
      expect(auditHtml(`<p>${text}</p>`).map((f) => f.kind), escaped).toContain('email');
    }
  });

  it('gives a text row the length of its scrubbed text', () => {
    const text = 'Write to jane@corp.example — thanks'; // the dash is three bytes
    const flight = `0:["$","div",null,{}]\n1:T${bytes(text).toString(16)},${text}2:["$","p",null,{}]\n`;
    const out = stream(new Scrubber().html(push(flight)));
    const m = /1:T([0-9a-f]+),/.exec(out)!;
    const scrubbed = 'Write to redacted-1@example.invalid — thanks';
    expect(parseInt(m[1]!, 16)).toBe(bytes(scrubbed));
    expect(out.slice(m.index + m[0].length)).toBe(`${scrubbed}2:["$","p",null,{}]\n`);
    expect(out.startsWith('0:["$","div",null,{}]\n')).toBe(true);
  });

  it('follows a text row from one push into the next', () => {
    const text = 'Ask jane@corp.example about <b>it</b>';
    const flight = `1:T${bytes(text).toString(16)},${text}2:"x"\n`;
    const cut = flight.indexOf('about');
    const out = new Scrubber().html(`${push(flight.slice(0, cut))}<p>between</p>${push(flight.slice(cut))}`);
    expect(out).not.toContain('jane@corp');
    expect(out).toContain('<p>between</p>');
    expect(out).not.toContain('<b>it');
    const s = stream(out);
    const m = /^1:T([0-9a-f]+),/.exec(s)!;
    const body = 'Ask redacted-1@example.invalid about <b>it</b>';
    expect(parseInt(m[1]!, 16)).toBe(bytes(body));
    expect(s.slice(m[0].length)).toBe(`${body}2:"x"\n`);
  });

  it('leaves a stream it cannot read to the plain scrub', () => {
    expect(new Scrubber().html(push('not a flight row jane@corp.example'))).not.toContain('jane@corp');
  });
});

// A signed-in page reads part of what it shows from the tab's session storage, which a recording of its requests
// never holds. The capture keeps it, without the sign-in itself, scrubbed like everything else.
describe('session storage', () => {
  const tab = {
    vt: '"[12,34]"',
    vt_ed: '"eyJrIjoiWzFdIn0="',
    st: '"[56]"',
    st_ed: '"eyJpIjoiWzJdIn0="',
    refreshToken: TOKEN,
    flowId: '"300000123"',
    draftUser: JSON.stringify({ email: 'jane@corp.example', firstName: 'Jane' }),
  };

  it('drops the sign-in and scrubs the rest', () => {
    const kept = sanitizeStorage(tab, new Scrubber({ terms: ['Jane'] }));
    expect(Object.keys(kept).sort()).toEqual(['draftUser', 'flowId']);
    expect(kept.flowId).toBe('"300000123"');
    expect(kept.draftUser).not.toContain('jane@corp.example');
    expect(kept.draftUser).not.toContain('Jane');
    expect(() => JSON.parse(kept.draftUser!)).not.toThrow();
  });

  it('reports a sign-in key or an address left in', () => {
    const kinds = auditStorage(tab).map((f) => f.kind);
    expect(kinds).toContain('sign-in-storage');
    expect(kinds).toContain('email');
    expect(auditStorage(sanitizeStorage(tab, new Scrubber()))).toEqual([]);
  });

  it('scrubs and audits the keys too: a page may cache an answer under the address it asked', () => {
    const cached = { '/api/candidate?email=jane@corp.example': '{}', 'draft:Jane': '1' };
    expect(auditStorage(cached, { terms: ['Jane'] }).map((f) => f.kind)).toEqual(expect.arrayContaining(['email', 'term']));
    const kept = sanitizeStorage(cached, new Scrubber({ terms: ['Jane'] }));
    expect(Object.keys(kept).join(' ')).not.toMatch(/jane|Jane/);
    expect(auditStorage(kept, { terms: ['Jane'] })).toEqual([]);
  });
});
