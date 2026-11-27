// Turns a bundle the extension's recorder handed over into a captured sample, laid out as `pnpm capture` writes one.
//
//   pnpm capture:import <downloaded .raf-capture.json>
//   pnpm capture:import <bundle> --name support-chrome --expected-from fixtures/captured/personio/support
//   pnpm capture:import <bundle> --resume <export.json> --force
//
// The audit runs again first, with ~/.raf-capture/scrub-terms.txt and a --resume export: the recorder build keeps no
// real resume, so this is where the applicant's own name is checked for. Anything found, and nothing is written.
// --cn (on by default for a Chinese page) also checks for mainland mobiles and ID card numbers.
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { WARNING_TEXT, looksChinese } from '../src/capture/checklist.ts';
import { sampleFromBundle } from '../src/capture/sample.ts';
import { jsdomHtml } from './capture/dom.ts';
import { readTerms } from './capture/terms.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const { values: args, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    name: { type: 'string' },
    force: { type: 'boolean', default: false },
    /** A sample of the same page whose expected.json this one shares. */
    'expected-from': { type: 'string' },
    resume: { type: 'string' },
    cn: { type: 'boolean' },
    /** Where samples live. For tests; fixtures/captured otherwise. */
    out: { type: 'string' },
  },
});

function die(message: string, code = 2): never {
  console.error(`capture:import: ${message}`);
  process.exit(code);
}

const [file] = positionals;
if (!file || positionals.length > 1) die('give one bundle: pnpm capture:import <file.raf-capture.json>');

let raw: unknown;
try {
  raw = JSON.parse(readFileSync(file, 'utf8'));
} catch (error) {
  die(`cannot read ${file}: ${(error as Error).message}`);
}
let terms: string[] = [];
try {
  terms = readTerms(args.resume);
} catch (error) {
  die(`cannot read --resume: ${(error as Error).message}`);
}
const meta = (raw as { meta?: { url?: string; locale?: string } } | null)?.meta;
const cn = args.cn ?? looksChinese(meta?.url ?? '', meta?.locale ?? '');

const result = sampleFromBundle(raw, { name: args.name, terms, cn, dom: jsdomHtml });
if (!result.ok) {
  for (const p of result.problems.slice(0, 40)) console.error(`  ${p}`);
  die(`${result.problems.length} problem(s); nothing written`, 1);
}

const dir = path.join(args.out ? path.resolve(args.out) : path.join(ROOT, 'fixtures', 'captured'), result.ats, result.name);
if (existsSync(dir) && readdirSync(dir).length > 0) {
  if (!args.force) die(`${dir} already has a sample; pass --force to replace it`);
  rmSync(dir, { recursive: true, force: true });
}
const expectedFrom = args['expected-from'] ? path.join(path.resolve(args['expected-from']), 'expected.json') : null;
if (expectedFrom && !existsSync(expectedFrom)) die(`no expected.json in ${args['expected-from']}`);

mkdirSync(dir, { recursive: true });
for (const [name, text] of Object.entries(result.files)) writeFileSync(path.join(dir, name), text);
if (expectedFrom) copyFileSync(expectedFrom, path.join(dir, 'expected.json'));

for (const w of result.warnings) console.warn(`  ! ${WARNING_TEXT[w]}`);
const entries = (JSON.parse(result.files['page.har']!) as { log: { entries: unknown[] } }).log.entries.length;
const pages = Object.keys(result.files).filter((n) => n.endsWith('.html')).length;
console.log(`imported ${result.ats}/${result.name}: ${entries} request(s), ${pages} page(s), audit clean`);
