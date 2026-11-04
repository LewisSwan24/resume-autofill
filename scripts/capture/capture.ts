// Records one application page into fixtures/captured/<ats>/<name>/: a HAR for replay, a static snapshot,
// screenshots and meta.json, all sanitised and audited. It only loads the page: no filling, no clicks.
// A `beforeRecord` hook (the manual login) runs before the HAR starts, so credentials are never recorded.
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { BrowserContext, Page } from '@playwright/test';
import { Scrubber, auditHar, auditHtml, sanitizeHar, sanitizeStaticHtml, type Finding, type HarFile, type SidecarIo } from './sanitize.ts';

/** Long edge limit: larger images get rejected in multi-image model requests. */
export const SHOT_SEGMENT = 1800;
const MAX_SEGMENTS = 8;

export interface CaptureOptions {
  url: string;
  dir: string;
  ats: string;
  name: string;
  terms?: string[] | undefined;
  /** Screenshots cannot be scrubbed, so logged-in captures turn them off. */
  screenshots?: boolean | undefined;
  /** Replace an existing sample. Off by default, because a page may have changed since. */
  force?: boolean | undefined;
  /** Runs after the first load and before recording starts. */
  beforeRecord?: ((page: Page) => Promise<void>) | undefined;
  settleMs?: number | undefined;
}

export interface CaptureResult {
  dir: string;
  findings: Finding[];
  entries: number;
  frames: { url: string; file: string }[];
  screenshots: string[];
  censusStatic: number;
}

interface Serialized {
  html: string;
  css: string;
  crossOriginSheets: string[];
}

// Runs in the page.
function serializeInPage(): Serialized {
  const shadowRoots: ShadowRoot[] = [];
  const walk = (root: ParentNode): void => {
    for (const el of root.querySelectorAll('*')) {
      if (el.shadowRoot) {
        shadowRoots.push(el.shadowRoot);
        walk(el.shadowRoot);
      }
    }
  };
  walk(document);

  const css: string[] = [];
  const crossOriginSheets: string[] = [];
  const readSheet = (sheet: CSSStyleSheet): void => {
    try {
      css.push([...sheet.cssRules].map((r) => r.cssText).join('\n'));
    } catch {
      if (sheet.href) crossOriginSheets.push(sheet.href);
    }
  };
  for (const sheet of document.styleSheets) readSheet(sheet);
  for (const root of shadowRoots) for (const sheet of root.adoptedStyleSheets) readSheet(sheet);

  const rootEl = document.documentElement as HTMLElement & {
    getHTML(o: { serializableShadowRoots?: boolean; shadowRoots?: ShadowRoot[] }): string;
  };
  const shell = rootEl.cloneNode(false) as HTMLElement;
  shell.innerHTML = '@@BODY@@';
  const html = `<!doctype html>${shell.outerHTML.replace('@@BODY@@', () => rootEl.getHTML({ serializableShadowRoots: true, shadowRoots }))}`;
  return { html, css: css.join('\n'), crossOriginSheets };
}

async function takeScreenshots(page: Page, dir: string): Promise<string[]> {
  const size = await page.evaluate(() => ({
    width: Math.min(document.documentElement.scrollWidth, 1800),
    height: document.documentElement.scrollHeight,
  }));
  const files: string[] = [];
  const count = Math.min(Math.ceil(size.height / SHOT_SEGMENT), MAX_SEGMENTS);
  for (let i = 0; i < count; i++) {
    const file = `shot-${i + 1}.png`;
    await page.screenshot({
      path: path.join(dir, file),
      fullPage: true,
      animations: 'disabled',
      clip: { x: 0, y: i * SHOT_SEGMENT, width: size.width, height: Math.min(SHOT_SEGMENT, size.height - i * SHOT_SEGMENT) },
    });
    files.push(file);
  }
  return files;
}

/** Sidecar bodies. Text that is not valid UTF-8 reads as null: rewriting it would corrupt it, so the audit refuses it. */
export function sidecarIo(dir: string): SidecarIo {
  const decoder = new TextDecoder('utf-8', { fatal: true });
  return {
    read(name) {
      const file = path.join(dir, path.basename(name));
      if (!existsSync(file)) return null;
      try {
        return decoder.decode(readFileSync(file));
      } catch {
        return null;
      }
    },
    write(name, text) {
      writeFileSync(path.join(dir, path.basename(name)), text);
    },
    remove(name) {
      rmSync(path.join(dir, path.basename(name)), { force: true });
    },
  };
}

/** Closes `context`, which is what flushes the HAR. */
export async function capturePage(context: BrowserContext, opts: CaptureOptions): Promise<CaptureResult> {
  const { dir } = opts;
  if (existsSync(dir) && readdirSync(dir).length > 0 && !opts.force) {
    throw new Error(`${dir} already has a sample; pass force to replace it`);
  }
  mkdirSync(dir, { recursive: true });
  const harPath = path.join(dir, 'page.har');

  const page = await context.newPage();
  if (opts.beforeRecord) {
    await page.goto(opts.url, { waitUntil: 'load', timeout: 60_000 });
    await opts.beforeRecord(page);
  }

  await context.routeFromHAR(harPath, { update: true, updateContent: 'attach', updateMode: 'full' });

  const sheets = new Map<string, Promise<string>>();
  page.on('response', (r) => {
    if (r.request().resourceType() === 'stylesheet') sheets.set(r.url(), r.text().catch(() => ''));
  });

  await page.goto(opts.url, { waitUntil: 'load', timeout: 60_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => {});
  await page.waitForTimeout(opts.settleMs ?? 1500);

  const screenshots = opts.screenshots === false ? [] : await takeScreenshots(page, dir);

  const raw: { url: string; data: Serialized }[] = [];
  for (const frame of page.frames()) {
    const url = frame.url();
    if (!/^https?:/.test(url)) continue;
    const data = await frame.evaluate(serializeInPage).catch(() => null);
    if (data) raw.push({ url, data });
  }
  const cssFor = async (d: Serialized): Promise<string> => {
    const extra = await Promise.all(d.crossOriginSheets.map((href) => sheets.get(href) ?? Promise.resolve('')));
    return [...extra, d.css].filter(Boolean).join('\n');
  };
  const pages = await Promise.all(raw.map(async (f) => ({ url: f.url, html: f.data.html, css: await cssFor(f.data) })));

  await context.close();

  // ---- sanitise. One scrubber: a placeholder means the same value everywhere in this sample.
  const scrub = new Scrubber({ terms: opts.terms });
  const io = sidecarIo(dir);
  const har = JSON.parse(readFileSync(harPath, 'utf8')) as HarFile;
  sanitizeHar(har, scrub, io);
  writeFileSync(harPath, JSON.stringify(har));

  const frames: CaptureResult['frames'] = [];
  const findings: Finding[] = [...auditHar(har, io, { terms: opts.terms })];
  pages.forEach((p, i) => {
    const file = i === 0 ? 'page.html' : `frame-${i}.html`;
    const html = sanitizeStaticHtml(p.html, scrub, { css: p.css });
    writeFileSync(path.join(dir, file), html);
    frames.push({ url: scrub.text(p.url), file });
    findings.push(...auditHtml(html, { terms: opts.terms }).map((f) => ({ ...f, where: `${file}: ${f.where}` })));
  });

  writeFileSync(
    path.join(dir, 'meta.json'),
    `${JSON.stringify(
      {
        ats: opts.ats,
        name: opts.name,
        url: scrub.text(opts.url),
        capturedAt: new Date().toISOString(),
        frames,
        screenshots,
        harEntries: har.log.entries.length,
        auditFindings: findings.length,
      },
      null,
      2,
    )}\n`,
  );

  return { dir, findings, entries: har.log.entries.length, frames, screenshots, censusStatic: pages.length };
}
