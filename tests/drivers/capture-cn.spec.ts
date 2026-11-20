// The capture tool on a Chinese portal opened as a phone. The page plants an applicant's details everywhere a
// real one would: visible text, data attributes, inline script state under unrelated keys, an API answer, a
// query string and a frame. Captured with the applicant's resume as the term list, none of it may survive.
// Every value below is invented; the ID number has a valid check digit on a made-up region.
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { capturePage } from '../../scripts/capture/capture.ts';
import { contextOptionsFor } from '../../scripts/capture/device.ts';
import { resumeTerms } from '../../scripts/capture/sanitize.ts';

const MOBILE = '13900001111';
const ID_CARD = '123456199001011233';
const EMAIL = 'fake.person@example.cn';
const RESUME = {
  basics: { familyName: '甲', givenName: '乙丙', idNumber: ID_CARD },
  contact: { email: EMAIL, phone: MOBILE, address: { city: '北京', street: '虚构路 1 号' } },
  education: [{ school: '虚构大学', schoolEn: 'Fakeston University' }],
};
// An emergency contact the resume does not hold: only the patterns can catch these.
const OTHER_MOBILE = '13700002222';
const OTHER_ID_CARD = '987654200002298763';
const PLANTED = {
  name: '甲乙丙',
  school: '虚构大学',
  schoolEn: 'Fakeston University',
  street: '虚构路 1 号',
  mobile: MOBILE,
  idCard: ID_CARD,
  email: EMAIL,
  otherMobile: OTHER_MOBILE,
  otherIdCard: OTHER_ID_CARD,
};

function listen(handler: Parameters<typeof createServer>[1]): Promise<{ server: Server; base: string }> {
  return new Promise((resolve) => {
    const server = createServer(handler);
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, base: `http://127.0.0.1:${(server.address() as AddressInfo).port}` });
    });
  });
}

const PAGE = (frameBase: string): string => `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width">
<title>投递简历</title>
<script>window.__STATE__={"u":{"n":"${PLANTED.name}","ref":"${MOBILE}","card":${ID_CARD},"s":"${PLANTED.school}"},"c":{"r":"${OTHER_MOBILE}","k":${OTHER_ID_CARD}}};</script>
</head><body>
<p>欢迎 ${PLANTED.name}（${PLANTED.school} / ${PLANTED.schoolEn}），地址：${PLANTED.street}</p>
<p>手机：${MOBILE}，身份证：${ID_CARD}，邮箱：${EMAIL}</p>
<p>紧急联系人：${OTHER_MOBILE}，${OTHER_ID_CARD}</p>
<div id="card" data-m="${MOBILE}" data-id="${ID_CARD}" data-c="${OTHER_MOBILE}" data-k="${OTHER_ID_CARD}"></div>
<form><label for="phone">手机号码</label><input id="phone" value="${MOBILE}"></form>
<div id="async"></div>
<iframe id="fr" src="${frameBase}/frame"></iframe>
<script>
  fetch('/api/me?m=${MOBILE}').then(r => r.json()).then(d => {
    document.getElementById('async').innerHTML = '<label>已加载 '+ (d.ok ? '是' : '否') +'<input id="async-input"></label>';
  });
</script>
</body></html>`;

// A mobile the resume does not hold, which page script puts into a URL with encodeURIComponent, alone, behind
// +86 and in a list. The scrub replaces it in the state and in the recorded URLs alike, so each replayed request
// must still find its answer.
const ENCODED_MOBILE = '13600003333';
const ENCODED_PAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>核对</title>
<script>window.__S__={"ref":"${ENCODED_MOBILE}","intl":"+86 ${ENCODED_MOBILE}","list":"${ENCODED_MOBILE},${OTHER_MOBILE}"};</script></head><body><p id="out">…</p><a id="call" href="tel:+86${ENCODED_MOBILE}">电话</a>
<script>
  Promise.all([window.__S__.ref, window.__S__.intl, window.__S__.list].map((m) => fetch('/api/check?m=' + encodeURIComponent(m)).then((r) => r.json())))
    .then((all) => { document.getElementById('out').textContent = all.every((d) => d.ok) ? 'ok' : 'bad'; })
    .catch(() => { document.getElementById('out').textContent = 'fail'; });
</script></body></html>`;

let site: { server: Server; base: string };
let frameHost: { server: Server; base: string };

test.beforeAll(async () => {
  frameHost = await listen((_req, res) => {
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(`<!doctype html><meta charset="utf-8"><body><label>学校<input id="frame-field"></label><p>${PLANTED.school} ${ID_CARD}</p></body>`);
  });
  site = await listen((req, res) => {
    const url = new URL(req.url!, 'http://x');
    if (url.pathname === '/api/check') {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: url.searchParams.get('m') !== null }));
    } else if (url.pathname === '/encoded') {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(ENCODED_PAGE);
    } else if (url.pathname === '/api/me') {
      res.setHeader('content-type', 'application/json; charset=utf-8');
      res.end(JSON.stringify({ ok: url.searchParams.get('m') !== null, mobileNo: MOBILE, x: MOBILE, idCard: ID_CARD, mail: EMAIL, school: PLANTED.school, name: PLANTED.name, c: OTHER_MOBILE, k: OTHER_ID_CARD }));
    } else {
      res.setHeader('content-type', 'text/html; charset=utf-8');
      res.end(PAGE(frameHost.base));
    }
  });
});

test.afterAll(() => {
  site.server.close();
  frameHost.server.close();
});

test('a phone capture of a Chinese page keeps none of the applicant’s details, in any file', async ({ browser }) => {
  const root = mkdtempSync(path.join(tmpdir(), 'raf-capture-cn-'));
  const dir = path.join(root, 'sample');
  try {
    const context = await browser.newContext({ ...contextOptionsFor('mobile', 'zh-CN'), serviceWorkers: 'block' });
    const result = await capturePage(context, {
      url: `${site.base}/apply`,
      dir,
      ats: 'test',
      name: 'cn-phone',
      terms: resumeTerms(RESUME),
      cn: true,
      device: 'mobile',
      locale: 'zh-CN',
      settleMs: 300,
    });
    expect(result.findings).toEqual([]);
    expect(result.frames.map((f) => f.file)).toEqual(['page.html', 'frame-1.html']);

    const files = readdirSync(dir);
    expect(files.some((f) => f.endsWith('.har'))).toBe(true);
    for (const file of files) {
      const text = readFileSync(path.join(dir, file)).toString('utf8');
      for (const [kind, value] of Object.entries(PLANTED)) {
        expect(text.includes(value), `${kind} in ${file}`).toBe(false);
        expect(text.includes(encodeURIComponent(value)), `${kind} (url-encoded) in ${file}`).toBe(false);
      }
    }

    const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8'));
    expect(meta).toMatchObject({ device: 'mobile', locale: 'zh-CN', auditFindings: 0 });
    expect(readFileSync(path.join(dir, 'page.html'), 'utf8')).toContain('手机号码');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a mobile that page script url-encodes still replays from the scrubbed HAR', async ({ browser }) => {
  const root = mkdtempSync(path.join(tmpdir(), 'raf-capture-cn-'));
  const dir = path.join(root, 'sample');
  try {
    const context = await browser.newContext({ ...contextOptionsFor('mobile', 'zh-CN'), serviceWorkers: 'block' });
    const result = await capturePage(context, {
      url: `${site.base}/encoded`,
      dir,
      ats: 'test',
      name: 'cn-encoded',
      terms: resumeTerms(RESUME),
      cn: true,
      device: 'mobile',
      locale: 'zh-CN',
      settleMs: 300,
    });
    expect(result.findings).toEqual([]);
    for (const file of readdirSync(dir)) {
      const text = readFileSync(path.join(dir, file)).toString('utf8');
      for (const mobile of [ENCODED_MOBILE, OTHER_MOBILE]) {
        expect(text.includes(mobile), `mobile left in ${file}`).toBe(false);
      }
    }

    const replay = await browser.newContext({ serviceWorkers: 'block' });
    await replay.routeFromHAR(path.join(dir, 'page.har'), { notFound: 'abort' });
    const page = await replay.newPage();
    const hits: string[] = [];
    const onRequest = (req: { url?: string }): void => {
      hits.push(req.url ?? '');
    };
    site.server.on('request', onRequest);
    await page.goto(`${site.base}/encoded`);
    await expect(page.locator('#out')).toHaveText('ok');
    site.server.off('request', onRequest);
    expect(hits, 'replay must not reach the server').toEqual([]);
    await replay.close();
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
