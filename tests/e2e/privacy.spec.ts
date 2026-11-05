import { readFileSync } from 'node:fs';
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
  for (const secret of ['zhiyuan.lin@example.com', '0412345678', 'Zhiyuan']) {
    expect(bodies.filter((b) => b.includes(secret))).toEqual([]);
  }
});

test('the extension\'s own pages cannot reach the network at all', async ({ context, serviceWorker, extensionId }) => {
  await waitForSeed(serviceWorker);
  for (const name of ['options.html', 'sidepanel.html']) {
    const page = await context.newPage();
    await page.goto(`chrome-extension://${extensionId}/${name}`);
    const blocked = await page.evaluate(async () => {
      const seen = new Promise<string>((resolve) => document.addEventListener('securitypolicyviolation', (e) => resolve(e.effectiveDirective), { once: true }));
      void fetch('https://no-such-host.invalid/').catch(() => undefined);
      return Promise.race([seen, new Promise<string>((resolve) => setTimeout(() => resolve('not blocked'), 3000))]);
    });
    expect(blocked, name).toBe('connect-src');
    await page.close();
  }
});

test('the scripts that run on pages have no way to send anything', () => {
  const read = (file: string): string => readFileSync(path.join(EXT, file), 'utf8');
  const sends = /\bfetch\(|XMLHttpRequest|sendBeacon|new WebSocket|new EventSource|importScripts/g;
  expect(read('background.js').match(sends)).toBeNull();
  expect(read('content-scripts/content.js').match(sends)).toBeNull();
  // The floating button loads its own stylesheet from the package. Those two calls are all there is.
  const fab = read('content-scripts/fab.js');
  expect(fab.match(sends)).toHaveLength(2);
  expect(fab).toContain('runtime.getURL(`/content-scripts/fab.css`)');
});

test('the parsers are not in what runs on pages, and the manifest asks for nothing new', () => {
  const read = (file: string): string => readFileSync(path.join(EXT, file), 'utf8');
  for (const file of ['background.js', 'content-scripts/content.js', 'content-scripts/fab.js']) {
    expect(read(file), file).not.toMatch(/GlobalWorkerOptions|convertToHtml/);
  }
  const manifest = JSON.parse(read('manifest.json')) as { permissions: string[] };
  expect(manifest.permissions.sort()).toEqual(['sidePanel', 'storage', 'unlimitedStorage', 'webNavigation']);
});
