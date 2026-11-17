import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { EXT, expect, test } from './fixtures';
import { FIXTURE_ORIGIN, fabBox, fillFixture, fixtureUrl, waitForSeed } from './helpers';

// The extension must not announce itself to the page: no window.postMessage carrying the
// WXT "content-script-started" signal or the extension id.
test('content scripts post no messages to the page window', async ({ context, extensionId }) => {
  const page = await context.newPage();
  await page.addInitScript(() => {
    const seen: string[] = [];
    (window as unknown as { __rafSeen: string[] }).__rafSeen = seen;
    window.addEventListener('message', (e) => {
      try {
        seen.push(typeof e.data === 'string' ? e.data : JSON.stringify(e.data));
      } catch {
        seen.push(String(e.data));
      }
    });
  });
  await page.goto(fixtureUrl('native'));
  await fabBox(page); // FAB mounted → both content scripts have started in the top frame
  await page.waitForTimeout(500); // allow any late postMessage to be delivered (test-only wait)
  const seen = await page.evaluate(() => (window as unknown as { __rafSeen: string[] }).__rafSeen);
  const leaks = seen.filter((s) => s.includes(extensionId) || s.includes('content-script-started'));
  expect(leaks).toEqual([]);
});

test('filling a form sends nothing anywhere', async ({ context, serviceWorker }) => {
  const away: string[] = [];
  const bodies: string[] = [];
  context.on('request', (request) => {
    const url = request.url();
    if (!url.startsWith('chrome-extension://') && !url.startsWith(FIXTURE_ORIGIN) && !url.startsWith('data:') && !url.startsWith('blob:')) away.push(url);
    bodies.push(`${url} ${request.postData() ?? ''}`);
  });
  const { page, report } = await fillFixture(context, serviceWorker, 'native', 'en-AU');
  expect(report.counts.filled).toBeGreaterThan(5);
  await page.waitForTimeout(500);
  expect(away).toEqual([]);
  // However it is written: a page's own script could only send what it could read, and these are what a leak looks like.
  for (const secret of ['zhiyuan.lin@example.com', '0412345678', 'Zhiyuan']) {
    const ways = [secret, encodeURIComponent(secret), Buffer.from(secret).toString('base64'), Buffer.from(secret).toString('base64url')];
    for (const way of ways) expect(bodies.filter((b) => b.includes(way)), way).toEqual([]);
  }
});

test('the extension\'s own pages cannot reach the network at all', async ({ context, serviceWorker, extensionId }) => {
  await waitForSeed(serviceWorker);
  for (const name of ['options.html', 'sidepanel.html']) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${name}`);
    const blocked = await page.evaluate(async () => {
      const seen = new Set<string>();
      document.addEventListener('securitypolicyviolation', (e) => seen.add(e.effectiveDirective));
      void fetch('https://no-such-host.invalid/').catch(() => undefined);
      new Image().src = 'https://no-such-host.invalid/i.png';
      const frame = document.createElement('iframe');
      frame.src = 'https://no-such-host.invalid/';
      frame.style.display = 'none';
      document.body.append(frame);
      const form = document.createElement('form');
      form.action = 'https://no-such-host.invalid/';
      form.method = 'post';
      form.target = '_blank';
      document.body.append(form);
      form.submit();
      await new Promise((resolve) => setTimeout(resolve, 1500));
      return [...seen].sort();
    });
    expect(blocked, name).toEqual(['connect-src', 'form-action', 'frame-src', 'img-src']);
    await page.close();
  }
});

test('the scripts that run on pages have no way to send anything', () => {
  const read = (file: string): string => readFileSync(path.join(EXT, file), 'utf8');
  const sends = /\bfetch\(|XMLHttpRequest|sendBeacon|new WebSocket|new EventSource|importScripts|new Image\b/g;
  expect(read('background.js').match(sends)).toBeNull();
  // Every script a page can end up running, so that nothing moved into a file of its own goes unread.
  const scripts = readdirSync(path.join(EXT, 'content-scripts')).filter((file) => file.endsWith('.js'));
  expect(scripts).toEqual(expect.arrayContaining(['content.js', 'fab.js']));
  for (const file of scripts.filter((name) => name !== 'fab.js')) {
    expect(read(`content-scripts/${file}`).match(sends), file).toBeNull();
  }
  // The floating button loads its own stylesheet from the package. Those two calls are all there is.
  const fab = read('content-scripts/fab.js');
  expect(fab.match(sends)).toHaveLength(2);
  expect(fab).toContain('runtime.getURL(`/content-scripts/fab.css`)');
  // And what the manifest says runs on pages is all there is.
  const manifest = JSON.parse(read('manifest.json')) as { content_scripts: { js: string[] }[] };
  for (const file of manifest.content_scripts.flatMap((entry) => entry.js)) expect(scripts).toContain(path.basename(file));
});

test('the parsers and local AI fetchers are not in what runs on pages, and the manifest asks for nothing new', () => {
  const read = (file: string): string => readFileSync(path.join(EXT, file), 'utf8');
  for (const file of ['background.js', 'content-scripts/content.js', 'content-scripts/fab.js']) {
    expect(read(file), file).not.toMatch(/GlobalWorkerOptions|convertToHtml|api\/generate|api\/tags|LanguageModel|ai\.languageModel/);
  }
  const manifest = JSON.parse(read('manifest.json')) as { permissions: string[]; content_security_policy?: { extension_pages?: string } };
  expect(manifest.permissions.sort()).toEqual(['sidePanel', 'storage', 'unlimitedStorage', 'webNavigation']);
  const csp = manifest.content_security_policy?.extension_pages ?? '';
  expect(csp).toContain("connect-src 'self' http://127.0.0.1:* http://localhost:*");
  expect(csp).not.toMatch(/https:/);
});

test('extension pages never contact localhost Ollama automatically while disabled', async ({ context, serviceWorker, extensionId }) => {
  await waitForSeed(serviceWorker);
  const loopbackSeen: string[] = [];
  context.on('request', (req) => {
    const url = req.url();
    if (url.includes('127.0.0.1') || url.includes('localhost')) loopbackSeen.push(url);
  });
  for (const name of ['options.html', 'sidepanel.html']) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${name}`);
    await page.waitForTimeout(300);
    await page.close();
  }
  expect(loopbackSeen).toEqual([]);
});
