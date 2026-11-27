// What the extension's recorder hands over: one JSON file holding a sample's HAR, its frames as static HTML, the tab's
// session storage and its meta, sanitised the way the command-line capture sanitises a sample. While the audit finds
// anything, there is no file at all, only the findings.
import {
  Scrubber,
  auditHar,
  auditHtml,
  auditStorage,
  auditText,
  resumeTerms,
  sanitizeHar,
  sanitizeStaticHtml,
  sanitizeStorage,
  type Finding,
  type HarFile,
  type HtmlDom,
  type ScrubOptions,
  type SidecarIo,
} from './sanitize.ts';
import type { Serialized } from './serialize.ts';

export interface CaptureInput {
  meta: { ats: string; name: string; url: string; locale: string; device?: string | undefined };
  capturedAt: string;
  /** Bodies inline, as the recorder writes them. */
  har: HarFile;
  /** The top frame first. */
  frames: { url: string; data: Serialized }[];
  storage: { origin: string; sessionStorage: Record<string, string> } | null;
  scrub: ScrubOptions;
}

export interface CaptureMeta {
  ats: string;
  name: string;
  url: string;
  capturedAt: string;
  recordedWith: 'chrome';
  device: string;
  locale: string;
  frames: { url: string; file: string }[];
  screenshots: string[];
  harEntries: number;
  auditFindings: number;
}

export interface CaptureBundle {
  format: 'raf-capture';
  version: 1;
  meta: CaptureMeta;
  har: HarFile;
  pages: { file: string; html: string }[];
  storage?: { origin: string; sessionStorage: Record<string, string> };
}

export type CaptureResult = { ok: true; bundle: CaptureBundle } | { ok: false; findings: Finding[] };

// Bodies are inline: there are no attached files to read or write.
const INLINE: SidecarIo = { read: () => null, write: () => {}, remove: () => {} };

/** Every identifying value of every resume kept, so that none of them leaves in a recording. */
export function termsFrom(resumes: unknown[]): string[] {
  return [...new Set(resumes.flatMap((r) => resumeTerms(r)))];
}

/** The sheets another origin served, which a page cannot read, taken from what the recording heard. */
function crossOriginCss(data: Serialized, har: HarFile): string {
  const sheets = data.crossOriginSheets.map((href) => {
    const c = har.log.entries.find((e) => e.request.url === href && e.response.status === 200)?.response.content;
    return c?.text && c.encoding !== 'base64' ? c.text : '';
  });
  return [...sheets, data.css].filter(Boolean).join('\n');
}

export function auditCapture(bundle: CaptureBundle, opts: ScrubOptions & { dom?: HtmlDom | undefined }): Finding[] {
  const at = (file: string) => (f: Finding) => ({ ...f, where: `${file}: ${f.where}` });
  return [
    ...auditHar(bundle.har, INLINE, opts).map(at('page.har')),
    ...bundle.pages.flatMap((p) => auditHtml(p.html, opts).map(at(p.file))),
    ...(bundle.storage ? auditStorage(bundle.storage.sessionStorage, opts).map(at('storage.json')) : []),
    // The page addresses in the meta are scrubbed too.
    ...[bundle.meta.url, ...bundle.meta.frames.map((f) => f.url)].flatMap((url) => auditText(url, 'meta.json', opts)),
  ];
}

export function buildCapture(input: CaptureInput, audit: (bundle: CaptureBundle, opts: ScrubOptions) => Finding[] = auditCapture): CaptureResult {
  // One scrubber: a placeholder means the same value everywhere in the sample.
  const scrub = new Scrubber(input.scrub);
  const css = input.frames.map((f) => crossOriginCss(f.data, input.har));
  const har = structuredClone(input.har);
  sanitizeHar(har, scrub, INLINE);

  const pages = input.frames.map((f, i) => ({
    file: i === 0 ? 'page.html' : `frame-${i}.html`,
    html: sanitizeStaticHtml(f.data.html, scrub, { css: css[i] }),
  }));
  const kept = input.storage ? sanitizeStorage(input.storage.sessionStorage, scrub) : {};
  const bundle: CaptureBundle = {
    format: 'raf-capture',
    version: 1,
    meta: {
      ats: input.meta.ats,
      name: input.meta.name,
      url: scrub.text(input.meta.url),
      capturedAt: input.capturedAt,
      recordedWith: 'chrome',
      device: input.meta.device ?? 'desktop',
      locale: input.meta.locale,
      frames: input.frames.map((f, i) => ({ url: scrub.text(f.url), file: pages[i]!.file })),
      screenshots: [],
      harEntries: har.log.entries.length,
      auditFindings: 0,
    },
    har,
    pages,
    ...(input.storage && Object.keys(kept).length > 0 ? { storage: { origin: input.storage.origin, sessionStorage: kept } } : {}),
  };
  const findings = audit(bundle, input.scrub);
  return findings.length > 0 ? { ok: false, findings } : { ok: true, bundle };
}
