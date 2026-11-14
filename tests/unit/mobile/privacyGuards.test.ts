// @vitest-environment node
// Resume content must never reach logcat, the console or the network. These checks read the source from disk.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const appSrc = join(repo, 'mobile/app/src');
const javaDir = join(repo, 'mobile/android/app/src/main/java/app/raf/dev');

function walk(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, exts));
    else if (exts.test(name)) out.push(path);
  }
  return out;
}

/** Source without comments and string contents, so a word in a comment or a message does not count. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
}

function offenders(files: string[], pattern: RegExp): string[] {
  return files.filter((f) => pattern.test(code(readFileSync(f, 'utf8')))).map((f) => relative(repo, f));
}

const tsFiles = () => walk(appSrc, /\.(ts|tsx)$/);
const javaFiles = () => walk(javaDir, /\.java$/);

/** The argument text of every `call.reject(...)`, matched to its closing parenthesis. */
function rejectArguments(source: string): string[] {
  const args: string[] = [];
  const start = /\bcall\.reject\(/g;
  let m: RegExpExecArray | null;
  while ((m = start.exec(source))) {
    let depth = 1;
    let i = m.index + m[0].length;
    let inString = false;
    for (; i < source.length && depth > 0; i += 1) {
      const c = source[i];
      if (inString) {
        if (c === '\\') i += 1;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
    }
    args.push(source.slice(m.index + m[0].length, i - 1));
  }
  return args;
}

describe('privacy guards', () => {
  it('no console.* call in mobile/app/src', () => {
    expect(offenders(tsFiles(), /\bconsole\s*\.\s*\w+/)).toEqual([]);
  });

  it('no fetch, XMLHttpRequest or WebSocket in mobile/app/src', () => {
    expect(offenders(tsFiles(), /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\b|\bEventSource\b/)).toEqual([]);
  });

  it('capacitor.config.json keeps loggingBehavior "none"', () => {
    const config = JSON.parse(readFileSync(join(repo, 'mobile/capacitor.config.json'), 'utf8'));
    expect(config.loggingBehavior).toBe('none');
  });

  it('the Java plugins never import android.util.Log', () => {
    const files = javaFiles();
    expect(files.map((f) => relative(javaDir, f)).sort()).toEqual(
      expect.arrayContaining(['DocumentSaverPlugin.java', 'MainActivity.java', 'ProfileVaultPlugin.java']),
    );
    expect(offenders(files, /\bandroid\.util\.Log\b|\bLog\.[deivw]\s*\(|\bSystem\.(out|err)\b|printStackTrace/)).toEqual([]);
  });

  it('ProfileVaultPlugin and DocumentSaverPlugin put no call data into reject messages', () => {
    for (const name of ['ProfileVaultPlugin.java', 'DocumentSaverPlugin.java']) {
      const source = readFileSync(join(javaDir, name), 'utf8');
      const args = rejectArguments(source);
      expect(args.length, name).toBeGreaterThan(0);
      for (const arg of args) {
        // Allowed: string literals, UPPER_CASE constants, the caught exception `e` and its class name.
        const rest = arg
          .replace(/"(?:\\.|[^"\\])*"/g, '')
          .replace(/\be\.getClass\(\)\.getSimpleName\(\)/g, '');
        const words = rest.match(/[A-Za-z_]\w*/g) ?? [];
        const bad = words.filter((w) => w !== 'e' && w !== 'null' && !/^[A-Z][A-Z0-9_]*$/.test(w));
        expect(bad, `${name}: call.reject(${arg})`).toEqual([]);
      }
    }
  });

  it('DocumentSaverPlugin keeps the export out of the call that Android saves with the activity, and lets the call go', () => {
    // Capacitor writes the data of a call started with startActivityForResult into the activity's saved state (a Bundle
    // that leaves the app for system_server) every time the app goes to the background, until the call is released.
    const source = code(readFileSync(join(javaDir, 'DocumentSaverPlugin.java'), 'utf8'));
    const save = source.slice(source.indexOf('public void save('), source.indexOf('private void saveResult('));
    const removeAt = save.search(/call\.getData\(\)\.remove\(\s*""\s*\)/);
    expect(removeAt, 'the base64 data is removed from the call data').toBeGreaterThan(-1);
    expect(removeAt, 'before the picker starts').toBeLessThan(save.indexOf('startActivityForResult('));
    const result = source.slice(source.indexOf('private void saveResult('));
    expect(result).not.toMatch(/call\.getString\(\s*""\s*\)/);
    expect(result).toMatch(/bridge\.releaseCall\(\s*call\s*\)|getBridge\(\)\.releaseCall\(\s*call\s*\)/);
  });
});
