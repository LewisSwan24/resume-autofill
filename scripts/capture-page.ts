// Capture one real application page for offline regression. Loads the page only: no filling, no clicking.
//
//   pnpm capture --ats greenhouse --name sample-a --url <url>     public page, headless
//   pnpm capture --ats bamboohr --name sample-a --url <url> --open '<selector>'
//                                                                 presses the one button that shows the form first
//   pnpm capture --ats workday --name step-1 --url <url> --login  opens a window, waits for a manual login
//   pnpm capture --ats workday --name step-2 --url <url> --profile  reuses that login, headless
//   pnpm capture --ats moka --name phone-a --url <url> --device mobile --locale zh-CN --login \
//     --profile-dir <dir> --resume <export.json>          a Chinese portal as a phone, in a profile of your own
//
// --profile-dir takes any browser profile directory outside the repository instead of ~/.raf-capture/profiles/<ats>.
// --resume takes a resume export: its names, schools, addresses and contact details become scrub terms.
// --cn (on by default for a zh locale) also redacts mainland mobiles under any key and ID card numbers.
//
// Logins live outside the repository in ~/.raf-capture/profiles/<ats>. Logged-in captures require
// ~/.raf-capture/scrub-terms.txt (one literal per line: name, address, and so on), because no pattern can
// recognise a person's name. They also skip screenshots, which cannot be scrubbed.
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { chromium, type Page } from '@playwright/test';
import { capturePage } from './capture/capture.ts';
import { openForm } from './capture/open.ts';
import { DEFAULT_LOCALE, contextOptionsFor, parseDevice, type CaptureDevice } from './capture/device.ts';
import { resumeTerms } from './capture/sanitize.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const HOME = path.join(homedir(), '.raf-capture');
const TERMS_FILE = path.join(HOME, 'scrub-terms.txt');

const { values: args } = parseArgs({
  options: {
    ats: { type: 'string' },
    name: { type: 'string' },
    url: { type: 'string' },
    login: { type: 'boolean', default: false },
    profile: { type: 'boolean', default: false },
    /** A logged-in browser profile directory to use instead of ~/.raf-capture/profiles/<ats>. Never inside the repo. */
    'profile-dir': { type: 'string' },
    /** A resume export whose identifying values must not survive. Read, never copied. */
    resume: { type: 'string' },
    /** Chinese redaction (mobiles under any key, ID card numbers). On by default for a zh locale. */
    cn: { type: 'boolean' },
    force: { type: 'boolean', default: false },
    locale: { type: 'string', default: DEFAULT_LOCALE },
    /** desktop, or mobile for a site's phone pages (narrow, touch, an Android user agent). */
    device: { type: 'string', default: 'desktop' },
    /** Wait for this file to appear instead of Enter, for a run with no terminal of its own. */
    'ready-file': { type: 'string' },
    /** The button that shows the form on the same page. Never one that sends: see capture/open.ts. */
    open: { type: 'string' },
  },
});

function die(message: string): never {
  console.error(`capture: ${message}`);
  process.exit(2);
}

const SLUG = /^[a-z0-9][a-z0-9-]*$/;
if (!args.ats || !SLUG.test(args.ats)) die('--ats must be a lowercase slug');
if (!args.name || !SLUG.test(args.name)) die('--name must be a lowercase slug');
if (!args.url || !/^https?:\/\//.test(args.url)) die('--url must be http(s)');
if (args.open !== undefined && !args.open.trim()) die('--open needs the selector of the button that shows the form');
const { ats, name, url } = { ats: args.ats, name: args.name, url: args.url };
let device: CaptureDevice = 'desktop';
try {
  device = parseDevice(args.device);
} catch (error) {
  die((error as Error).message);
}
const locale = args.locale ?? DEFAULT_LOCALE;

const cn = args.cn ?? /^zh\b/i.test(locale);

const profileDirArg = args['profile-dir'] ? path.resolve(args['profile-dir']) : undefined;
if (profileDirArg) {
  // Outside means a parent step (".." alone or "../…") or another drive. A folder named "..profiles" is inside.
  const rel = path.relative(ROOT, profileDirArg);
  const outside = rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel);
  if (!outside) die('--profile-dir must be outside the repository');
}
const authenticated = args.login || args.profile || profileDirArg !== undefined;
let terms: string[] = [];
if (existsSync(TERMS_FILE)) {
  terms = readFileSync(TERMS_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
if (args.resume) {
  try {
    terms = [...new Set([...terms, ...resumeTerms(JSON.parse(readFileSync(args.resume, 'utf8')))])];
  } catch (error) {
    die(`cannot read --resume: ${(error as Error).message}`);
  }
}
if (authenticated && terms.length === 0) die(`logged-in capture needs terms in ${TERMS_FILE} or a --resume`);

/** The window stays with the user until they say the page is ready. */
const waitForFile = async (file: string): Promise<void> => {
  while (!existsSync(file)) await new Promise((resolve) => setTimeout(resolve, 1000));
};

async function waitForUser(): Promise<void> {
  const readyFile = args['ready-file'];
  if (readyFile) {
    console.log('Log in in the browser window.');
    await waitForFile(readyFile);
    return;
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  await rl.question('Log in in the browser window and open the application page, then press Enter here. ');
  rl.close();
}

/** What happens between the page's load and its snapshot: the manual walk to the form, then the button that shows it. */
function beforeSnapshot(): ((page: Page) => Promise<void>) | undefined {
  const walk = args.login && args['ready-file'] ? `${args['ready-file']}.form` : null;
  const open = args.open;
  if (!walk && !open) return undefined;
  return async (page) => {
    if (walk) await waitForFile(walk);
    if (open) await openForm(page, open);
  };
}

const dir = path.join(ROOT, 'fixtures', 'captured', ats, name);
const profileDir = profileDirArg ?? path.join(HOME, 'profiles', ats);
if (authenticated) mkdirSync(profileDir, { recursive: true });

const contextOptions = { ...contextOptionsFor(device, locale), serviceWorkers: 'block' as const };
const browser = authenticated ? null : await chromium.launch();
const context = authenticated
  ? await chromium.launchPersistentContext(profileDir, { ...contextOptions, headless: !args.login, channel: 'chromium' })
  : await browser!.newContext(contextOptions);

const result = await capturePage(context, {
  url,
  dir,
  ats,
  name,
  terms,
  cn,
  force: args.force,
  device,
  locale,
  // A page that may show the resume's values cannot be screenshotted: pixels cannot be scrubbed.
  screenshots: !authenticated && !args.resume,
  beforeRecord: args.login ? waitForUser : undefined,
  // Recording by now, and past the login: the walk to the form is part of what a replay needs.
  beforeSnapshot: beforeSnapshot(),
});
await browser?.close();

if (result.findings.length > 0) {
  // Nothing suspect stays around by accident: the sample is removed and the (masked) reasons are printed.
  for (const f of result.findings.slice(0, 40)) console.error(`  ${f.kind}  ${f.where}  ${f.sample}`);
  rmSync(dir, { recursive: true, force: true });
  console.error(`capture: audit found ${result.findings.length} leak(s); sample removed`);
  process.exit(1);
}
console.log(`captured ${ats}/${name} (${device}): ${result.entries} requests, ${result.frames.length} frame(s), ${result.screenshots.length} screenshot(s), audit clean`);
