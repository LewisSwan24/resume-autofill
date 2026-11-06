/// <reference types="chrome" />
// Privacy regression (M1.1): every frame of the tab is asked what it needs (`frame:needs`, no data) and gets
// only that. A third-party iframe without a form receives nothing, the same-origin iframe receives a resume
// subset without the fields the top frame filled, and the attachment goes to the frame with the upload control.
// Observed from the service worker side by wrapping `chrome.tabs.sendMessage` (the background calls it live).
import { expect, test } from './fixtures';
import { fabBox, fixtureUrl, scanTotal, setActiveResumeByLocale, storedReport, tabIdOf, waitForSeed } from './helpers';

interface Sent {
  frameId: number | undefined;
  msg: { type: string; resume?: Record<string, any>; files?: Record<string, unknown> };
}

test('frames receive only the resume data they need (third-party iframe gets nothing)', async ({ context, serviceWorker }) => {
  await waitForSeed(serviceWorker);
  await setActiveResumeByLocale(serviceWorker, 'en-AU');

  const url = fixtureUrl('native');
  const page = await context.newPage();
  await page.goto(url);
  await page.frameLocator('iframe[title="Additional questions"]').getByLabel('Notice period').waitFor();
  // A third-party frame: other origin (127.0.0.1 vs localhost), a page without any form.
  await page.evaluate(() => {
    const frame = document.createElement('iframe');
    frame.title = 'third-party';
    frame.src = 'http://127.0.0.1:4173/';
    document.body.append(frame);
  });
  await page.frameLocator('iframe[title="third-party"]').locator('h1').waitFor();

  const tabId = await tabIdOf(serviceWorker, url);
  const deadline = Date.now() + 20_000;
  while ((await scanTotal(serviceWorker, tabId)) === 0) {
    if (Date.now() > deadline) throw new Error('no fields detected');
    await page.waitForTimeout(150);
  }

  // Frame ids by url, and proof that the third-party frame runs a content script (it answers frame:needs: nothing).
  const frames = await serviceWorker.evaluate(
    async (id) => ((await chrome.webNavigation.getAllFrames({ tabId: id })) ?? []).map((f) => ({ frameId: f.frameId, url: f.url })),
    tabId,
  );
  const topId = frames.find((f) => f.frameId === 0)!.frameId;
  const sameOriginId = frames.find((f) => f.url.endsWith('/native/frame.html'))!.frameId;
  const thirdPartyId = frames.find((f) => f.url.startsWith('http://127.0.0.1:4173'))!.frameId;
  const answersNothing = () =>
    serviceWorker.evaluate(
      async ({ id, frameId }) => {
        try {
          const needs = await chrome.tabs.sendMessage(id, { type: 'frame:needs' }, { frameId });
          return !!needs && needs.fieldKeys.length === 0 && needs.repeatSections.length === 0 && needs.attachmentKeys.length === 0;
        } catch {
          return false;
        }
      },
      { id: tabId, frameId: thirdPartyId },
    );
  const needsDeadline = Date.now() + 20_000;
  while (!(await answersNothing())) {
    if (Date.now() > needsDeadline) throw new Error('third-party frame never answered frame:needs');
    await page.waitForTimeout(150);
  }
  // Record every tabs.sendMessage the background makes from now on.
  await serviceWorker.evaluate(() => {
    const g = globalThis as unknown as { __sent: unknown[] };
    g.__sent = [];
    const original = chrome.tabs.sendMessage.bind(chrome.tabs) as (...a: unknown[]) => Promise<unknown>;
    (chrome.tabs as unknown as { sendMessage: unknown }).sendMessage = (tab: number, msg: unknown, opts?: { frameId?: number }) => {
      g.__sent.push({ frameId: opts?.frameId, msg: JSON.parse(JSON.stringify(msg)) });
      return original(tab, msg, opts);
    };
  });

  const box = await fabBox(page);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  const reportDeadline = Date.now() + 60_000;
  while (!(await storedReport(serviceWorker, tabId))) {
    if (Date.now() > reportDeadline) throw new Error('no report stored after clicking the FAB');
    await page.waitForTimeout(200);
  }
  const sent = await serviceWorker.evaluate(() => (globalThis as unknown as { __sent: Sent[] }).__sent);

  // The count on the button can go out at any moment, as a late frame reports in. It may carry nothing but the count.
  for (const s of sent.filter((x) => x.msg.type === 'scan:total')) expect(Object.keys(s.msg).sort()).toEqual(['total', 'type']);
  const to = (frameId: number) => sent.filter((s) => s.frameId === frameId && !s.msg.type.startsWith('report:') && s.msg.type !== 'scan:total');
  const fillTo = (frameId: number) => to(frameId).find((s) => s.msg.type === 'frame:fill');

  // every frame was asked first, with a payload-free message
  for (const id of [topId, sameOriginId, thirdPartyId]) {
    expect(to(id)[0]?.msg, `frame ${id} is asked first`).toEqual({ type: 'frame:needs' });
  }
  // the third-party frame got nothing but that question
  expect(to(thirdPartyId).map((s) => s.msg.type)).toEqual(['frame:needs']);
  for (const s of sent) {
    if (s.frameId === thirdPartyId) expect(JSON.stringify(s.msg)).not.toMatch(/zhiyuan|Zhiyuan|data:/);
  }

  // the same-origin iframe (notice period / earliest start) gets just those leaves, and no files
  const frameFill = fillTo(sameOriginId)!;
  expect(frameFill, 'iframe is filled').toBeTruthy();
  expect(frameFill.msg.files).toEqual({});
  expect(frameFill.msg.resume!.jobIntention.noticePeriod).toBe('2 weeks');
  const frameJson = JSON.stringify(frameFill.msg);
  for (const secret of ['zhiyuan.lin@example.com', 'Zhiyuan', 'Australian National University', 'Canberra', 'ByteDance', '0412345678']) {
    expect(frameJson, secret).not.toContain(secret);
  }

  // the top frame has the resume upload: it alone receives the file
  const topFill = fillTo(topId)!;
  expect(Object.keys(topFill.msg.files!)).toEqual(['sample-resume-en']);
  expect(JSON.stringify(topFill.msg.resume)).not.toContain('sample-photo');
  for (const s of sent) {
    if (s.frameId !== topId) expect(JSON.stringify(s.msg)).not.toContain('data:application/pdf');
  }
});
