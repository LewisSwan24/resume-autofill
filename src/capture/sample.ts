// A bundle the recorder handed over, as the files of a captured sample laid out as the command line writes one:
// page.har, page.html, frame-N.html, storage.json and meta.json. The audit runs again first, with the terms only this
// computer knows: a recorder build keeps no real resume, so the applicant's own name reaches it only from here.
// Nothing here touches the disk; scripts/capture-import.ts writes the files.
import { auditCapture, type CaptureBundle } from './bundle.ts';
import { pageWarnings, type PageWarning } from './checklist.ts';
import type { HtmlDom } from './sanitize.ts';

export type SampleResult =
  | { ok: true; ats: string; name: string; files: Record<string, string>; warnings: PageWarning[] }
  | { ok: false; problems: string[] };

export interface SampleOptions {
  /** Another name for the sample than the one it was recorded under. */
  name?: string | undefined;
  /** Literals that must not survive: scrub-terms.txt and a resume export's values. */
  terms?: string[] | undefined;
  cn?: boolean | undefined;
  dom?: HtmlDom | undefined;
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
const PAGE_FILE = /^(?:page|frame-[1-9]\d*)\.html$/;

const json = (value: unknown): string => `${JSON.stringify(value, null, 2)}\n`;

function isBundle(raw: unknown): raw is CaptureBundle {
  const b = raw as Partial<CaptureBundle> | null;
  return !!b && b.format === 'raf-capture' && b.version === 1 && !!b.meta && !!b.har && Array.isArray(b.pages);
}

export function sampleFromBundle(raw: unknown, opts: SampleOptions = {}): SampleResult {
  if (!isBundle(raw)) return { ok: false, problems: ['not a recorder bundle (format raf-capture, version 1)'] };
  const bundle = raw;
  const { ats } = bundle.meta;
  const name = opts.name ?? bundle.meta.name;
  if (!SLUG.test(ats)) return { ok: false, problems: [`the platform must be a lowercase slug: ${ats}`] };
  if (!SLUG.test(name)) return { ok: false, problems: [`the sample name must be a lowercase slug: ${name}`] };
  const odd = bundle.pages.find((p) => !PAGE_FILE.test(p.file));
  if (odd) return { ok: false, problems: [`a page file name no sample has: ${odd.file}`] };

  const findings = auditCapture(bundle, { terms: opts.terms, cn: opts.cn, dom: opts.dom });
  if (findings.length > 0) return { ok: false, problems: findings.map((f) => `${f.kind} ${f.where} ${f.sample}`) };

  const files: Record<string, string> = {
    'page.har': JSON.stringify(bundle.har),
    'meta.json': json({ ...bundle.meta, name }),
  };
  for (const p of bundle.pages) files[p.file] = p.html;
  if (bundle.storage) files['storage.json'] = json(bundle.storage);
  return { ok: true, ats, name, files, warnings: pageWarnings(bundle.pages) };
}
