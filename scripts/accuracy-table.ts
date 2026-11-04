// Writes the per-ATS accuracy table from the last `pnpm test:captured` run into the local acceptance docs.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCURACY_FILE, renderAccuracyTable, type SampleScore } from '../tests/shared/capturedExpectations.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(ROOT, 'docs', 'reviews', 'm2-accuracy.md');
const rows = JSON.parse(readFileSync(ACCURACY_FILE, 'utf8')) as SampleScore[];
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `# M2 按 ATS 统计的准确率\n\n生成时间：${new Date().toISOString()}\n\n${renderAccuracyTable(rows)}`);
console.log(`${rows.length} row(s) -> ${path.relative(ROOT, out)}`);
