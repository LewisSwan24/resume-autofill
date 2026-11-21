// @vitest-environment node
// What the page bundle and the session model may depend on: the import graph is walked from disk.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const rel = (f: string) => relative(repo, f).replace(/\\/g, '/');
const modelDir = join(repo, 'mobile/app/src/browser/model');
const entry = join(repo, 'mobile/inject/entry.ts');
const protocol = join(repo, 'mobile/bridge/protocol.ts');
const modelFiles = () => readdirSync(modelDir).filter((n) => n.endsWith('.ts')).map((n) => join(modelDir, n));
/** Reused from the profile page on purpose; it imports fields.tsx, so React is already in the app bundle. */
const SUMMARY = join(repo, 'mobile/app/src/home/summary.ts');

/** Source without comments and string contents (same idea as privacyGuards). */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
}

/** Runtime import specifiers of a file (type-only imports and re-exports do not reach the bundle). */
function specifiers(source: string): string[] {
  const out: string[] = [];
  const re = /^\s*(import|export)\s+(type\s+)?(?:[\s\S]*?\s+from\s+)?['"]([^'"]+)['"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m[2]) continue;
    if (m[1] === 'export' && !/\bfrom\b/.test(m[0])) continue;
    out.push(m[3]!);
  }
  for (const d of source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)) out.push(d[1]!);
  return out;
}

function resolveFile(from: string, spec: string): string | null {
  const base = resolve(dirname(from), spec);
  for (const candidate of [base, `${base}.ts`, `${base}.tsx`, join(base, 'index.ts'), join(base, 'index.tsx')]) {
    if (existsSync(candidate) && !candidate.endsWith('.d.ts') && /\.(ts|tsx)$/.test(candidate)) return candidate;
  }
  return null;
}

function walk(starts: string[], stopAt: ReadonlySet<string> = new Set()) {
  const files = new Set<string>();
  const bare = new Map<string, string>();
  const todo = [...starts];
  while (todo.length) {
    const file = todo.pop()!;
    if (files.has(file)) continue;
    files.add(file);
    if (stopAt.has(file)) continue;
    for (const spec of specifiers(readFileSync(file, 'utf8'))) {
      if (spec.startsWith('.')) {
        const target = resolveFile(file, spec);
        if (target) todo.push(target);
      } else if (!bare.has(spec)) {
        bare.set(spec, rel(file));
      }
    }
  }
  return { files: [...files].map(rel), bare };
}

function offenders(files: string[]): string[] {
  return files.filter(
    (f) =>
      f === 'src/content/index.ts' ||
      f.startsWith('src/messaging/') ||
      f.startsWith('src/storage/') ||
      // The auto-advance loop is pure (its only imports are types), so the fill browser runs it unchanged.
      (f.startsWith('src/background/') && !['src/background/subset.ts', 'src/background/merge.ts', 'src/background/autoAdvance.ts'].includes(f)),
  );
}

describe('import boundary of the page bundle and the session model', () => {
  const page = walk([entry, protocol]);
  const model = walk(modelFiles());
  const modelUntilSummary = walk(modelFiles(), new Set([SUMMARY]));

  it('walks a real graph', () => {
    expect(page.files).toContain('src/content/handlers.ts');
    expect(page.files).toContain('src/fill/runFill.ts');
    expect(model.files).toContain('src/background/subset.ts');
    expect(model.files).toContain('mobile/bridge/protocol.ts');
  });

  it('has no wxt, src/content/index.ts, src/messaging, src/storage or other src/background files', () => {
    for (const graph of [page, model]) {
      expect([...graph.bare.keys()].filter((s) => s === 'wxt' || s.startsWith('wxt/'))).toEqual([]);
      expect(offenders(graph.files)).toEqual([]);
    }
  });

  it('has no react in the page bundle, nor in the model outside the reused home/summary.ts', () => {
    const react = (g: ReturnType<typeof walk>) => [...g.bare].filter(([s]) => s === 'react' || s.startsWith('react/') || s === 'react-dom');
    expect(react(page)).toEqual([]);
    expect(react(modelUntilSummary)).toEqual([]);
  });

  it('the page bundle needs nothing but zod from node_modules', () => {
    expect([...page.bare.keys()].filter((s) => s !== 'zod')).toEqual([]);
  });

  it('no console, network, eval or Function in mobile/inject, mobile/bridge and the model', () => {
    const dirs = ['mobile/inject', 'mobile/bridge', 'mobile/app/src/browser/model'];
    const files = dirs.flatMap((d) =>
      readdirSync(join(repo, d))
        .filter((n) => /\.(ts|tsx|mjs)$/.test(n) && n !== 'vite.config.ts')
        .map((n) => join(repo, d, n)),
    );
    expect(files.length).toBeGreaterThan(10);
    const banned = /\bconsole\s*\.|\bfetch\s*\(|XMLHttpRequest|WebSocket|sendBeacon|\beval\s*\(|new\s+Function\b/;
    expect(files.filter((f) => banned.test(code(readFileSync(f, 'utf8')))).map(rel)).toEqual([]);
  });

  it('the page entry assigns nothing to window or globalThis', () => {
    const src = code(readFileSync(entry, 'utf8'));
    expect(src).not.toMatch(/\b(window|globalThis|self)\s*(\.\s*\w+|\[[^\]]*\])\s*=(?!=)/);
    expect(src).not.toMatch(/(defineProperty|assign)\(\s*(window|globalThis|self)\b/);
    expect(src).not.toMatch(/^\s*export\s/m);
  });
});
