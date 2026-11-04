// The capture tool end to end against a local server that behaves like a real ATS page: cookies, a CSRF meta,
// personal data in HTML, JSON and a stylesheet-hidden element, a tokened API call, an open shadow root and a
// cross-origin iframe. No real site is involved. All secrets below are fake.
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { SHOT_SEGMENT, capturePage, sidecarIo } from '../../scripts/capture/capture.ts';
import { auditHar, type HarFile } from '../../scripts/capture/sanitize.ts';

const SECRETS = {
  cookie: 'cookie-secret-value-1',
  csrf: 'csrf-secret-value-22222',
  apiToken: 'api-secret-token-33333',
  email: 'jane.private@corp.example',
  frameEmail: 'frame.private@corp.example',
  phone: '0412 345 678',
  password: 'hunter2-fake-password',
  name: 'Janet Private',
};

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    });
  });
}

let site: { server: Server; base: string };
let frameHost: { server: Server; base: string };
const posted: string[] = [];

// Contains personal data, so sanitising changes its bytes and the page's integrity hash stops matching.
const SRI_SCRIPT = `window.sriScriptRan = true; var support = "${SECRETS.email}";`;
const SRI_HASH = `sha384-${createHash('sha384').update(SRI_SCRIPT).digest('base64')}`;

const FORM = (frameBase: string): string => `<!doctype html><html lang="en"><head>
<meta name="csrf-token" content="${SECRETS.csrf}">
<link rel="stylesheet" href="/s.css">
<script src="/sri.js" integrity="${SRI_HASH}" crossorigin="anonymous"></script>
<title>Apply</title>
<script>var cfg={"access_token":"${SECRETS.apiToken}"};</script>
</head><body>
<h1>Welcome ${SECRETS.name}</h1>
<p class="hidden" id="hidden-note">Contact ${SECRETS.email} or ${SECRETS.phone}</p>
<form id="f">
  <label for="question_19000000001">First name</label><input id="question_19000000001" value="prefilled-private">
  <input type="hidden" name="authenticity_token" value="${SECRETS.csrf}">
</form>
<div id="host"></div>
<div id="async"></div>
<iframe id="fr" src="${frameBase}/frame"></iframe>
<div style="height:4000px">tall</div>
<script>
  document.getElementById('host').attachShadow({mode:'open'}).innerHTML = '<label>Shadow field<input id="in-shadow"></label>';
  fetch('/api/me?access_token=' + cfg.access_token).then(r => r.json()).then(d => {
    document.getElementById('async').innerHTML = '<label>Loaded '+ (d.ok ? 'yes' : 'no') +'<input id="async-input"></label>';
  });
</script>
</body></html>`;

test.beforeAll(async () => {
  frameHost = await listen((_req, res) => {
    res.setHeader('content-type', 'text/html');
    res.end(`<!doctype html><body><label>Frame field<input id="frame-field"></label><p>${SECRETS.frameEmail}</p></body>`);
  });
  site = await listen((req, res) => {
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/sri.js') {
      res.setHeader('content-type', 'text/javascript');
      res.setHeader('access-control-allow-origin', '*');
      res.end(SRI_SCRIPT);
    } else if (url.pathname === '/s.css') {
      res.setHeader('content-type', 'text/css');
      res.end('.hidden{display:none}');
    } else if (url.pathname === '/api/me') {
      res.setHeader('content-type', 'application/json');
      res.setHeader('set-cookie', `api=${SECRETS.cookie}`);
      res.end(JSON.stringify({ ok: url.searchParams.get('access_token') !== null, email: SECRETS.email, phone: SECRETS.phone, csrfToken: SECRETS.csrf, name: SECRETS.name }));
    } else if (url.pathname === '/login' && req.method === 'POST') {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        posted.push(body);
        res.statusCode = 302;
        res.setHeader('location', '/form');
        res.end();
      });
    } else {
      res.setHeader('content-type', 'text/html');
      res.setHeader('set-cookie', `sid=${SECRETS.cookie}; HttpOnly`);
      res.end(FORM(frameHost.base));
    }
  });
});

test.afterAll(() => {
  site.server.close();
  frameHost.server.close();
});

test.describe('capturePage on a page with secrets', () => {
  let dir: string;
  let result: Awaited<ReturnType<typeof capturePage>>;

  test.beforeAll(async ({ browser }) => {
    dir = path.join(mkdtempSync(path.join(tmpdir(), 'raf-capture-')), 'sample');
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    result = await capturePage(context, { url: `${site.base}/form`, dir, ats: 'test', name: 'sample', terms: [SECRETS.name], settleMs: 300 });
  });

  test.afterAll(() => rmSync(path.dirname(dir), { recursive: true, force: true }));

  test('the audit is clean', () => {
    expect(result.findings).toEqual([]);
  });

  test('no fake secret survives in any file, whatever its format', () => {
    for (const file of readdirSync(dir)) {
      const bytes = readFileSync(path.join(dir, file)).toString('latin1');
      for (const [kind, secret] of Object.entries(SECRETS)) {
        expect(bytes.includes(secret), `${kind} in ${file}`).toBe(false);
      }
    }
  });

  test('the HAR is structurally free of cookies', () => {
    const har = JSON.parse(readFileSync(path.join(dir, 'page.har'), 'utf8')) as HarFile;
    expect(har.log.entries.length).toBeGreaterThan(2);
    for (const e of har.log.entries) {
      expect(e.request.cookies).toEqual([]);
      expect(e.response.cookies).toEqual([]);
      for (const h of [...e.request.headers, ...e.response.headers]) expect(h.name.toLowerCase()).not.toMatch(/cookie|csrf/);
    }
    expect(auditHar(har, sidecarIo(dir))).toEqual([]);
  });

  test('the static snapshot keeps structure and loses state and scripts', () => {
    const html = readFileSync(path.join(dir, 'page.html'), 'utf8');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('prefilled-private');
    expect(html).toContain('question_19000000001');
    expect(html).toContain('shadowrootmode="open"');
    expect(html).toContain('in-shadow');
    expect(html).toContain('async-input');
  });

  test('the static snapshot loads with no network, hides what the page hid and parses the shadow root', async ({ browser }) => {
    const context = await browser.newContext({ javaScriptEnabled: true });
    const page = await context.newPage();
    const html = readFileSync(path.join(dir, 'page.html'), 'utf8');
    await page.route('**/*', (route) =>
      route.request().url() === `${site.base}/form`
        ? route.fulfill({ contentType: 'text/html', body: html })
        : route.abort(),
    );
    await page.goto(`${site.base}/form`);
    await expect(page.locator('#hidden-note')).toBeHidden();
    await expect(page.getByLabel('First name')).toBeVisible();
    await expect(page.getByLabel('First name')).toHaveValue('');
    await expect(page.getByLabel('Shadow field')).toBeVisible();
    await context.close();
  });

  test('each frame gets its own snapshot', () => {
    expect(result.frames.map((f) => f.file)).toEqual(['page.html', 'frame-1.html']);
    expect(readFileSync(path.join(dir, 'frame-1.html'), 'utf8')).toContain('frame-field');
  });

  test('the sanitised HAR replays offline: the JS runs and the tokened API call still matches', async ({ browser }) => {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    await context.routeFromHAR(path.join(dir, 'page.har'), { notFound: 'abort' });
    const page = await context.newPage();
    const hits: string[] = [];
    site.server.on('request', (req) => hits.push(req.url!));
    await page.goto(`${site.base}/form`);
    await expect(page.locator('#async-input')).toBeAttached();
    await expect(page.getByText('Loaded yes')).toBeVisible();
    expect(await page.evaluate(() => (window as unknown as { sriScriptRan?: boolean }).sriScriptRan), 'integrity must not block a scrubbed script').toBe(true);
    await expect(page.getByLabel('Shadow field')).toBeVisible();
    await expect(page.frameLocator('#fr').getByLabel('Frame field')).toBeVisible();
    expect(hits, 'replay must not reach the server').toEqual([]);
    await context.close();
  });

  test('screenshots are split so no image has a long edge over the limit', () => {
    expect(result.screenshots.length).toBeGreaterThan(1);
    for (const file of result.screenshots) {
      const png = readFileSync(path.join(dir, file));
      const [width, height] = [png.readUInt32BE(16), png.readUInt32BE(20)];
      expect(Math.max(width, height)).toBeLessThanOrEqual(SHOT_SEGMENT);
    }
  });

  test('meta.json records the sample without secrets', () => {
    const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ ats: 'test', name: 'sample', auditFindings: 0 });
    expect(meta.harEntries).toBe(result.entries);
  });

  test('refuses to overwrite an existing sample unless forced', async ({ browser }) => {
    const context = await browser.newContext();
    await expect(capturePage(context, { url: `${site.base}/form`, dir, ats: 'test', name: 'sample' })).rejects.toThrow(/already has a sample/);
    await context.close();
  });
});

test('a login that happens before recording never reaches the HAR', async ({ browser }) => {
  const root = mkdtempSync(path.join(tmpdir(), 'raf-capture-'));
  const dir = path.join(root, 'sample');
  try {
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const result = await capturePage(context, {
      url: `${site.base}/form`,
      dir,
      ats: 'test',
      name: 'login',
      terms: [SECRETS.name],
      screenshots: false,
      settleMs: 100,
      beforeRecord: async (page) => {
        await page.evaluate(async (password) => {
          await fetch('/login', { method: 'POST', body: `password=${password}` });
        }, SECRETS.password);
      },
    });
    expect(posted.join('')).toContain(SECRETS.password);
    expect(result.findings).toEqual([]);
    expect(result.screenshots).toEqual([]);
    for (const file of readdirSync(dir)) {
      expect(readFileSync(path.join(dir, file)).toString('latin1').includes(SECRETS.password), file).toBe(false);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
