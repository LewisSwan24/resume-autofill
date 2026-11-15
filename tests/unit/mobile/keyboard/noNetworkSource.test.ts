// @vitest-environment node
// The keyboard's Java sources (app/raf/dev/keyboard/*.java and VaultCrypto.java,
// the one app class it may use) reference no network, web, socket, reflection, native-code, clipboard or field-text
// API and no other app class. The same rules run over the compiled classes in KeyboardNoNetworkTest.java; this file
// is the source-level mirror, shown to work on a planted fixture that is never compiled.
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { codeOnly, javaFilesUnder, stripComments, violations, type Violation } from './noNetworkRules';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const appJava = join(repo, 'mobile/android/app/src/main/java/app/raf/dev');
const kbDir = join(appJava, 'keyboard');
const plant = join(repo, 'tests/unit/mobile/fixtures/keyboard/PlantedNetworkUse.java.txt');
const escapePlant = join(repo, 'tests/unit/mobile/fixtures/keyboard/PlantedEscape.java.txt');
const junit = join(repo, 'mobile/android/app/src/test/java/app/raf/dev/keyboard/KeyboardNoNetworkTest.java');

const appClasses = readdirSync(appJava).filter((n) => n.endsWith('.java')).map((n) => n.slice(0, -5));
const check = (path: string): Violation[] =>
  violations(readFileSync(path, 'utf8'), { ownClass: path.replace(/^.*[\\/]/, '').replace(/\.java(\.txt)?$/, ''), appClasses });
const has = (found: Violation[], kind: Violation['kind'], detail: string) =>
  found.some((v) => v.kind === kind && v.detail === detail);

describe('keyboard no-network rules (sources)', () => {
  it('the planted fixture is caught, once per banned kind', () => {
    const found = check(plant);
    expect(has(found, 'package', 'java.net.'), 'java.net import').toBe(true);
    expect(has(found, 'package', 'android.webkit.'), 'WebView import').toBe(true);
    expect(has(found, 'package', 'android.util.Log'), 'Log import').toBe(true);
    expect(has(found, 'package', 'java.lang.Runtime'), 'Runtime').toBe(true);
    expect(has(found, 'member', 'Class.forName'), 'Class.forName').toBe(true);
    expect(has(found, 'member', 'System.out'), 'System.out').toBe(true);
    expect(has(found, 'member', 'Log.'), 'Log.d').toBe(true);
    expect(has(found, 'call', 'getTextBeforeCursor'), 'getTextBeforeCursor').toBe(true);
    expect(has(found, 'call', 'printStackTrace'), 'printStackTrace').toBe(true);
    expect(has(found, 'native', 'native void hidden('), 'native method').toBe(true);
    expect(has(found, 'string', 'https://'), 'URL literal').toBe(true);
    expect(has(found, 'string', 'java.net'), 'class name literal').toBe(true);
    expect(has(found, 'appClass', 'MainActivity'), 'other app class').toBe(true);
  });

  it('the planted escape is caught: other packages, broadcasts, services, parsed intents, method handles', () => {
    const found = check(escapePlant);
    expect(has(found, 'foreign', 'org.json'), 'third-party import').toBe(true);
    expect(has(found, 'foreign', 'com.example'), 'qualified third-party name').toBe(true);
    expect(has(found, 'appClass', 'app.raf.other'), 'app package outside app.raf.dev').toBe(true);
    expect(has(found, 'call', 'sendOrderedBroadcast'), 'ordered broadcast').toBe(true);
    expect(has(found, 'call', 'startService'), 'service').toBe(true);
    expect(has(found, 'member', 'Intent.parseUri'), 'parsed intent').toBe(true);
    expect(has(found, 'member', 'Intent.ACTION_SEND'), 'share action').toBe(true);
    expect(has(found, 'member', 'MethodHandles.'), 'method handles').toBe(true);
    expect(has(found, 'package', 'android.app.PendingIntent'), 'pending intent').toBe(true);
  });

  it('javaFilesUnder lists sources in subfolders too', () => {
    const root = mkdtempSync(join(tmpdir(), 'kbsrc-'));
    try {
      mkdirSync(join(root, 'util', 'deeper'), { recursive: true });
      writeFileSync(join(root, 'Top.java'), '');
      writeFileSync(join(root, 'util', 'deeper', 'Http.java'), '');
      writeFileSync(join(root, 'util', 'notes.txt'), '');
      expect(javaFilesUnder(root).map((f) => f.slice(root.length + 1).replace(/\\/g, '/')).sort()).toEqual(['Top.java', 'util/deeper/Http.java']);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('a class rule does not catch a lookalike name (java.lang.Runtime is not java.lang.RuntimeException)', () => {
    const ok = 'class A { void f() { throw new java.lang.RuntimeException(); } }';
    expect(violations(ok, { ownClass: 'A', appClasses: [] })).toEqual([]);
    const bad = 'class A { Object f() { return java.lang.Runtime.getRuntime(); } }';
    expect(violations(bad, { ownClass: 'A', appClasses: [] }).map((v) => v.detail)).toContain('java.lang.Runtime');
  });

  it('comments do not count and a quote char literal does not confuse the scanner', () => {
    const src = `// java.net.URL getTextBeforeCursor( Log.d\n/* System.out */ class A { char q = '"'; String s = "ok"; }`;
    expect(violations(src, { ownClass: 'A', appClasses: [] })).toEqual([]);
    expect(stripComments(src)).not.toContain('java.net');
    expect(codeOnly(`char q = '"'; String s = "java.net";`)).toBe(`char q = ''; String s = "";`);
  });

  it('the keyboard sources and VaultCrypto are clean', () => {
    expect(existsSync(kbDir), 'keyboard/ exists').toBe(true);
    const files = javaFilesUnder(kbDir);
    const names = files.map((f) => f.replace(/^.*[\\/]/, ''));
    expect(names).toEqual(expect.arrayContaining(['ResumeKeyboardService.java', 'KeyboardDataStore.java', 'KbJson.java']));
    const all = [...files, join(appJava, 'VaultCrypto.java')].flatMap((f) =>
      check(f).map((v) => `${f.replace(/^.*[\\/]/, '')}: ${v.kind} ${v.detail}`),
    );
    expect(all).toEqual([]);
  });

  it('the app-class allowlist holds: keyboard code names only VaultCrypto, R and BuildConfig outside its package', () => {
    const used = new Set<string>();
    for (const n of readdirSync(kbDir).filter((x) => x.endsWith('.java'))) {
      const code = codeOnly(stripComments(readFileSync(join(kbDir, n), 'utf8')));
      for (const m of code.matchAll(/\bimport\s+app\.raf\.dev\.(\w+)\s*;/g)) used.add(m[1]!);
    }
    expect(used.has('VaultCrypto')).toBe(true);
    for (const u of used) expect(['VaultCrypto', 'R', 'BuildConfig']).toContain(u);
    // VaultCrypto itself names no other app class.
    expect(check(join(appJava, 'VaultCrypto.java')).filter((v) => v.kind === 'appClass')).toEqual([]);
  });

  it('the JUnit check bans the same prefixes, members and strings', async () => {
    const rules = await import('./noNetworkRules');
    const java = readFileSync(junit, 'utf8');
    for (const p of rules.BANNED_PREFIXES) expect(java, p).toContain(`"${p.replace(/\./g, '/')}"`);
    for (const c of rules.BANNED_CALLS) expect(java, c).toContain(`"${c}"`);
    for (const s of rules.BANNED_STRINGS) expect(java, s).toContain(`"${s}"`);
    for (const p of rules.ALLOWED_EXTERNAL) expect(java, p).toContain(`"${p.replace(/\./g, '/')}/"`);
    for (const m of ['Class.forName', 'System.loadLibrary', 'System.load', 'System.out', 'System.err']) {
      expect(java, m).toContain(`"java/lang/${m}"`);
    }
  });
});
