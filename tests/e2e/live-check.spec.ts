// The live check opens real application pages, so its guard gets proof against a local server that behaves
// like one: it saves on every change, uploads a file as soon as it is chosen, sends beacons and opens a socket.
// The server is the witness: nothing but GETs may reach it.
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { advanceLive, guardWrites, runLiveCheck } from '../../scripts/live/liveCheck.ts';
import { expect, test } from './fixtures';

const FORM = `<!doctype html><html><head><title>Apply</title></head><body>
<form id="application" method="post" action="/submit">
  <label for="first">First Name</label><input id="first" name="first">
  <label for="last">Last Name</label><input id="last" name="last">
  <label for="cv">Resume</label><input id="cv" name="cv" type="file">
  <button type="submit">Submit application</button>
</form>
<script>
  const form = document.getElementById('application');
  form.addEventListener('input', () => {
    fetch('/autosave', { method: 'POST', body: new FormData(form) }).catch(() => {});
  });
  document.getElementById('cv').addEventListener('change', () => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/upload');
    xhr.send('file bytes');
  });
  navigator.sendBeacon('/beacon', 'loaded');
  window.socketState = 'not opened';
  try {
    const socket = new WebSocket(location.origin.replace('http', 'ws') + '/socket');
    socket.onopen = () => { socket.send('hello'); window.socketState = 'open'; };
    socket.onclose = () => { window.socketState = 'closed'; };
  } catch {}
</script>
</body></html>`;

/** Steps on one page: the first Next is client-side, the second must save to the server before it moves on. */
const WIZARD = `<!doctype html><html><head><title>Apply in steps</title></head><body>
<section id="s1">
  <label for="first">First Name</label><input id="first" name="first" required>
  <label for="last">Last Name</label><input id="last" name="last" required>
  <button type="button" id="n1">Next</button>
</section>
<section id="s2" hidden>
  <label for="email">Email</label><input id="email" name="email" type="email">
  <button type="button" id="n2">Save and Continue</button>
</section>
<section id="s3" hidden>
  <button type="button" id="send">Submit application</button>
</section>
<script>
  const show = (id) => ['s1', 's2', 's3'].forEach((s) => (document.getElementById(s).hidden = s !== id));
  document.getElementById('n1').addEventListener('click', () => show('s2'));
  document.getElementById('n2').addEventListener('click', () => {
    fetch('/save', { method: 'POST', body: 'step 2' }).then((r) => r.ok && show('s3'), () => {});
  });
  document.getElementById('send').addEventListener('click', () => fetch('/submit', { method: 'POST' }));
</script>
</body></html>`;

interface Seen {
  method: string;
  path: string;
}

let server: Server;
let base: string;
let seen: Seen[] = [];
let upgrades = 0;

test.beforeAll(async () => {
  server = createServer((req, res) => {
    seen.push({ method: req.method!, path: req.url! });
    res.setHeader('content-type', 'text/html');
    res.end(req.url?.startsWith('/wizard') ? WIZARD : FORM);
  });
  server.on('upgrade', (_req, socket) => {
    upgrades++;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

test.afterAll(() => {
  server.close();
});

test.beforeEach(() => {
  seen = [];
  upgrades = 0;
});

test('fills the page while no write reaches the server, and reports what it stopped', async ({ context, serviceWorker }) => {
  const guard = await guardWrites(context);
  const result = await runLiveCheck(context, serviceWorker, guard, { url: `${base}/apply`, locale: 'en-AU', settleMs: 200 });

  // The fill really happened, so the page really tried to save.
  const page = result.page;
  await expect(page.locator('#first')).toHaveValue('Zhiyuan');
  await expect(page.locator('#last')).toHaveValue('Lin');
  expect(result.report.counts.filled).toBeGreaterThanOrEqual(2);

  expect(seen.filter((r) => r.method !== 'GET')).toEqual([]);
  expect(upgrades).toBe(0);

  const blocked = result.blocked.map((b) => `${b.method} ${b.path}`);
  expect(blocked).toContain('POST /autosave');
  expect(blocked).toContain('PUT /upload');
  expect(blocked).toContain('POST /beacon');
  expect(result.blocked.every((b) => b.count >= 1 && b.host.startsWith('127.0.0.1'))).toBe(true);
  expect(result.socketsClosed).toBeGreaterThanOrEqual(1);
});

test('stays on the page and never submits', async ({ context, serviceWorker }) => {
  const guard = await guardWrites(context);
  const result = await runLiveCheck(context, serviceWorker, guard, { url: `${base}/apply`, locale: 'en-AU', settleMs: 200 });
  expect(result.navigatedTo).toEqual([]);
  expect(seen.some((r) => r.path.startsWith('/submit'))).toBe(false);
  expect(result.blocked.some((b) => b.path === '/submit')).toBe(false);
});

test('a submit that does happen is stopped by the guard and shows up in the result', async ({ context, serviceWorker }) => {
  const guard = await guardWrites(context);
  const result = await runLiveCheck(context, serviceWorker, guard, { url: `${base}/apply`, locale: 'en-AU', settleMs: 200 });
  await result.page.locator('form').evaluate((form: HTMLFormElement) => form.submit());
  await expect.poll(() => guard.blocked().some((b) => b.path === '/submit')).toBe(true);
  expect(seen.some((r) => r.path.startsWith('/submit'))).toBe(false);
});

test('a GraphQL read gets through, since some forms load that way, and a mutation does not', async ({ context }) => {
  const guard = await guardWrites(context);
  const page = await context.newPage();
  await page.goto(`${base}/apply`);
  const send = (method: string, path: string, body: string) =>
    page.evaluate(
      ([m, p, b]) => fetch(p!, { method: m!, headers: { 'content-type': 'application/json' }, body: b }).then(() => true, () => false),
      [method, path, body],
    );
  const post = (path: string, body: string) => send('POST', path, body);
  expect(await post('/graphql', JSON.stringify({ operationName: 'Form', query: 'query Form($id: ID!) { form(id: $id) { title } }' }))).toBe(true);
  expect(await post('/api/non-user-graphql?op=Short', JSON.stringify({ query: '{ form { title } }' }))).toBe(true);

  const stopped: [string, string, string][] = [
    ['POST', '/graphql/save', JSON.stringify({ operationName: 'Save', query: 'mutation Save { save(text: "query") { id } }' })],
    ['POST', '/graphql/both', JSON.stringify({ query: 'query A { a } mutation B { b }' })],
    ['POST', '/graphql/batch', JSON.stringify([{ query: 'mutation Save { save { id } }' }])],
    ['POST', '/graphql/text', 'query=1'],
    ['POST', '/graphql/string', JSON.stringify({ operationName: 'B', query: 'query A { f(s: "#") } mutation B { del }' })],
    ['POST', '/graphql/cr', JSON.stringify({ query: 'query A { f } #\r mutation B { del }' })],
    ['DELETE', '/graphql/application', JSON.stringify({ query: '{}' })],
    ['PUT', '/graphql/application', JSON.stringify({ query: '{}' })],
    ['POST', '/api/application/draft', JSON.stringify({ query: 'query about visa', email: 'a@b.example' })],
  ];
  for (const [method, path, body] of stopped) expect(await send(method, path, body), `${method} ${path}`).toBe(false);

  const reached = seen.filter((r) => r.method !== 'GET').map((r) => r.path);
  expect(reached).toEqual(['/graphql', '/api/non-user-graphql?op=Short']);
  expect(guard.blocked().map((b) => b.path)).toEqual(expect.arrayContaining(stopped.map(([, path]) => path)));
});

test('query strings are left out of the log, since they can hold what was typed', async ({ context }) => {
  const guard = await guardWrites(context);
  const page = await context.newPage();
  await page.goto(`${base}/apply`);
  await page.evaluate(() => fetch('/save?email=private@example.com', { method: 'POST' }).catch(() => {}));
  await expect.poll(() => guard.blocked().map((b) => b.path)).toContain('/save');
  expect(JSON.stringify(guard.blocked())).not.toContain('private');
});

test('auto-advance on a live page: presses only Next, and a step that must save first stops it, with the save blocked', async ({
  context,
  serviceWorker,
}) => {
  const guard = await guardWrites(context);
  const result = await runLiveCheck(context, serviceWorker, guard, { url: `${base}/wizard`, locale: 'en-AU', settleMs: 200 });
  const advance = await advanceLive(result.page, serviceWorker, { timeoutMs: 60_000 });

  expect(advance.offered).toBe(true);
  expect(advance.state).toEqual({ running: false, steps: 1, stopReason: 'not_advanced' });
  expect(advance.pressed).toEqual(['Next', 'Save and Continue']);
  expect(advance.leftOrigin).toEqual([]);
  expect(seen.filter((r) => r.method !== 'GET')).toEqual([]);
  expect(guard.blocked().map((b) => `${b.method} ${b.path}`)).toContain('POST /save');
  expect(guard.blocked().some((b) => b.path === '/submit')).toBe(false);
});

test('auto-advance is not offered on a single-page form, and nothing is pressed', async ({ context, serviceWorker }) => {
  const guard = await guardWrites(context);
  const result = await runLiveCheck(context, serviceWorker, guard, { url: `${base}/apply`, locale: 'en-AU', settleMs: 200 });
  const advance = await advanceLive(result.page, serviceWorker, { timeoutMs: 10_000 });
  expect(advance.offered).toBe(false);
  expect(advance.pressed).toEqual([]);
  expect(seen.some((r) => r.path.startsWith('/submit'))).toBe(false);
});
