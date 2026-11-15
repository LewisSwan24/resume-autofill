// The no-network rules of KeyboardNoNetworkTest.java (which reads the compiled
// constant pools), restated over Java sources. Comments are stripped first; imports, fully qualified names, member
// calls, `native` methods and string literals are checked. Keep the lists in step with the JUnit test.
import { readdirSync } from 'node:fs';
import { join } from 'node:path';

/** Banned packages and classes, dotted form (the JUnit test uses the internal form with slashes). */
export const BANNED_PREFIXES = [
  'java.net.', 'javax.net.', 'android.net.', 'android.webkit.', 'androidx.webkit.', 'okhttp3.', 'okio.',
  'com.android.okhttp.', 'org.apache.http.', 'android.app.DownloadManager', 'java.nio.channels.',
  'com.getcapacitor.', 'android.util.Log', 'java.lang.reflect.', 'java.lang.ClassLoader', 'dalvik.system.',
  'java.lang.Runtime', 'java.lang.ProcessBuilder', 'android.content.ClipboardManager',
  'android.content.ClipData', 'android.bluetooth.', 'android.nfc.', 'android.telephony.SmsManager',
  'android.app.PendingIntent',
] as const;

/** Packages outside the app that keyboard code may name at all (the banned rules still apply inside them). */
export const ALLOWED_EXTERNAL = [
  'java.lang', 'java.util', 'java.io', 'java.nio', 'java.security', 'javax.crypto', 'java.text', 'java.time', 'java.math',
  'android', 'androidx.core', 'androidx.annotation', 'dalvik.annotation',
] as const;

/** Roots of the package names the foreign check looks for in imports and qualified names. */
const PACKAGE_ROOTS = ['org', 'com', 'net', 'io', 'kotlin', 'kotlinx', 'androidx', 'javax', 'java', 'android', 'dalvik', 'okhttp3', 'okio'];

/** java.lang classes need no import, so their simple names are banned too. */
export const BANNED_SIMPLE_TYPES = ['ClassLoader', 'Runtime', 'ProcessBuilder'] as const;

/** Banned on a known owner: `Owner.member`. */
export const BANNED_MEMBERS = [
  'Class.forName', 'System.loadLibrary', 'System.load', 'System.out', 'System.err', 'Log.', 'Intent.parseUri',
  'Intent.getIntent', 'Intent.ACTION_SEND', 'Intent.ACTION_VIEW', 'Intent.ACTION_WEB_SEARCH', 'MethodHandles.',
  'MethodHandle.', 'MethodType.',
] as const;

/** Banned as a call whatever the receiver. */
export const BANNED_CALLS = [
  'printStackTrace', 'getTextBeforeCursor', 'getTextAfterCursor', 'getSelectedText', 'getSurroundingText',
  'getExtractedText', 'sendBroadcast', 'getContentResolver', 'bindService', 'sendOrderedBroadcast',
  'sendStickyBroadcast', 'sendStickyOrderedBroadcast', 'sendBroadcastAsUser', 'sendOrderedBroadcastAsUser',
  'sendStickyBroadcastAsUser', 'sendStickyOrderedBroadcastAsUser', 'startService', 'startForegroundService',
  'startIntentSender', 'startActivities',
] as const;

export const BANNED_STRINGS = [
  'http://', 'https://', 'java.net', 'javax.net', 'okhttp', 'android.intent.action.SEND', 'android.intent.action.VIEW',
  'android.intent.action.WEB_SEARCH',
] as const;

/** App classes outside app.raf.dev.keyboard that keyboard code may use. */
export const ALLOWED_APP_CLASSES = ['VaultCrypto', 'R', 'BuildConfig'] as const;

export type ViolationKind = 'package' | 'member' | 'call' | 'native' | 'string' | 'appClass' | 'foreign';

/** Every .java file in a folder and the folders below it. */
export function javaFilesUnder(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? javaFilesUnder(join(dir, e.name)) : e.name.endsWith('.java') ? [join(dir, e.name)] : [],
  );
}
export interface Violation {
  kind: ViolationKind;
  detail: string;
}

/** Remove comments; keep string literals (they are checked separately). */
export function stripComments(source: string): string {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const c = source[i]!;
    const next = source[i + 1];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== c && source[j] !== '\n') j += source[j] === '\\' ? 2 : 1;
      out += source.slice(i, j + 1);
      i = j + 1;
    } else if (c === '/' && next === '/') {
      while (i < source.length && source[i] !== '\n') i += 1;
    } else if (c === '/' && next === '*') {
      const end = source.indexOf('*/', i + 2);
      i = end < 0 ? source.length : end + 2;
      out += ' ';
    } else {
      out += c;
      i += 1;
    }
  }
  return out;
}

/** A string literal (group 1 = its body) or a char literal, matched left to right, so '"' is a char literal. */
const LITERAL = /"((?:\\.|[^"\\\n])*)"|'(?:\\.|[^'\\\n])*'/g;

/** The string literals of comment-free source, unescaped enough for substring checks. */
export function stringLiterals(source: string): string[] {
  return [...source.matchAll(LITERAL)].filter((m) => m[1] !== undefined).map((m) => m[1]!.replace(/\\(.)/g, '$1'));
}

/** Comment-free source with the contents of every string and char literal blanked. */
export function codeOnly(source: string): string {
  return source.replace(LITERAL, (m) => (m.startsWith('"') ? '""' : "''"));
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * Every rule a Java source breaks. `ownClass` is the file's class name, `appClasses` the simple names of the classes
 * in package app.raf.dev (used for same-package references from VaultCrypto.java, which needs no import).
 */
export function violations(source: string, o: { ownClass: string; appClasses: readonly string[] }): Violation[] {
  const out: Violation[] = [];
  const clean = stripComments(source);
  const code = codeOnly(clean);
  const pkg = /^\s*package\s+([\w.]+)\s*;/m.exec(code)?.[1] ?? '';

  // Imports and fully qualified names anywhere in the code.
  for (const p of BANNED_PREFIXES) {
    // A package rule ("java.net.") covers everything below it; a class rule covers the class, not RuntimeException.
    const re = new RegExp(`(?<![\\w.])${escape(p)}${p.endsWith('.') ? '' : '(?![\\w$])'}`, 'g');
    if (re.test(code)) out.push({ kind: 'package', detail: p });
  }
  for (const t of BANNED_SIMPLE_TYPES) {
    if (new RegExp(`(?<![\\w.])${t}\\b`).test(code)) out.push({ kind: 'package', detail: `java.lang.${t}` });
  }
  for (const m of BANNED_MEMBERS) {
    const re = m.endsWith('.') ? new RegExp(`(?<![\\w.])${escape(m)}\\w`) : new RegExp(`(?<![\\w.])${escape(m)}\\b`);
    if (re.test(code)) out.push({ kind: 'member', detail: m });
  }
  for (const c of BANNED_CALLS) {
    if (new RegExp(`\\b${c}\\s*\\(`).test(code) || new RegExp(`::\\s*${c}\\b`).test(code)) out.push({ kind: 'call', detail: c });
  }
  for (const m of code.matchAll(/\bnative\b[^;{=]*\(/g)) out.push({ kind: 'native', detail: m[0].trim() });
  for (const s of stringLiterals(clean)) {
    for (const b of BANNED_STRINGS) if (s.includes(b)) out.push({ kind: 'string', detail: b });
  }

  // Packages outside the platform and the allowlist, by import or qualified name (a library the scan does not read
  // could make the network call for the keyboard).
  const roots = PACKAGE_ROOTS.join('|');
  for (const m of code.matchAll(new RegExp(`(?<![\\w.])((?:${roots})(?:\\.[a-z_]\\w*)*)\\.[A-Z]`, 'g'))) {
    const pkgName = m[1]!;
    const allowed = ALLOWED_EXTERNAL.some((a) => pkgName === a || pkgName.startsWith(`${a}.`));
    if (!allowed && !out.some((v) => v.kind === 'foreign' && v.detail === pkgName)) out.push({ kind: 'foreign', detail: pkgName });
  }
  // App packages other than app.raf.dev (where the class rules below apply).
  for (const m of code.matchAll(/\bapp\.raf\.(?!dev\b)(\w+)/g)) {
    const detail = `app.raf.${m[1]!}`;
    if (!out.some((v) => v.kind === 'appClass' && v.detail === detail)) out.push({ kind: 'appClass', detail });
  }
  // App classes: imports or qualified names of app.raf.dev.X outside the keyboard package.
  for (const m of code.matchAll(/\bapp\.raf\.dev\.(\w+)/g)) {
    const name = m[1]!;
    if (name === 'keyboard' || name === 'kbfixture') continue;
    if (!(ALLOWED_APP_CLASSES as readonly string[]).includes(name)) out.push({ kind: 'appClass', detail: name });
  }
  // Same-package references (VaultCrypto.java lives in app.raf.dev and names other classes without an import).
  if (pkg === 'app.raf.dev') {
    for (const name of o.appClasses) {
      if (name === o.ownClass || (ALLOWED_APP_CLASSES as readonly string[]).includes(name)) continue;
      if (new RegExp(`(?<![\\w.])${name}\\b`).test(code)) out.push({ kind: 'appClass', detail: name });
    }
  }
  return out;
}
