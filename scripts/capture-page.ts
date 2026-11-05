// Capture one real application page for offline regression. Loads the page only: no filling, no clicking.
//
//   pnpm capture --ats greenhouse --name sample-a --url <url>     public page, headless
//   pnpm capture --ats workday --name step-1 --url <url> --login  opens a window, waits for a manual login
//   pnpm capture --ats workday --name step-2 --url <url> --profile  reuses that login, headless
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
import { chromium } from '@playwright/test';
import { capturePage } from './capture/capture.ts';

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
    force: { type: 'boolean', default: false },
    locale: { type: 'string', default: 'en-AU' },
    /** Wait for this file to appear instead of Enter, for a run with no terminal of its own. */
    'ready-file': { type: 'string' },
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
const { ats, name, url } = { ats: args.ats, name: args.name, url: args.url };

const authenticated = args.login || args.profile;
let terms: string[] = [];
if (existsSync(TERMS_FILE)) {
  terms = readFileSync(TERMS_FILE, 'utf8').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
}
if (authenticated && terms.length === 0) die(`logged-in capture needs terms in ${TERMS_FILE}`);

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

const dir = path.join(ROOT, 'fixtures', 'captured', ats, name);
const profileDir = path.join(HOME, 'profiles', ats);
if (authenticated) mkdirSync(profileDir, { recursive: true });

const contextOptions = {
  serviceWorkers: 'block' as const,
  viewport: { width: 1280, height: 900 },
  locale: args.locale,
};
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
  force: args.force,
  screenshots: !authenticated,
  beforeRecord: args.login ? waitForUser : undefined,
  // Recording by now, and past the login: the walk to the form is part of what a replay needs.
  beforeSnapshot: args.login && args['ready-file'] ? () => waitForFile(`${args['ready-file']}.form`) : undefined,
});
await browser?.close();

if (result.findings.length > 0) {
  // Nothing suspect stays around by accident: the sample is removed and the (masked) reasons are printed.
  for (const f of result.findings.slice(0, 40)) console.error(`  ${f.kind}  ${f.where}  ${f.sample}`);
  rmSync(dir, { recursive: true, force: true });
  console.error(`capture: audit found ${result.findings.length} leak(s); sample removed`);
  process.exit(1);
}
console.log(`captured ${ats}/${name}: ${result.entries} requests, ${result.frames.length} frame(s), ${result.screenshots.length} screenshot(s), audit clean`);
