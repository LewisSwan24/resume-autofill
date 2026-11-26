// Writes the per-ATS accuracy table from the last `pnpm test:captured` run into the local acceptance docs.
// Exits non-zero when a phone capture fills less than 90% of what the desktop capture of the same page fills, or
// when its page has several desktop captures. A phone capture with no desktop capture of its page is listed only.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ACCURACY_FILE, blocksAcceptance, PHONE_FLOOR, phoneShortfalls, renderAccuracyTable, type SampleScore } from '../tests/shared/capturedExpectations.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(ROOT, 'docs', 'reviews', 'm2-accuracy.md');
const rows = JSON.parse(readFileSync(ACCURACY_FILE, 'utf8')) as SampleScore[];
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `# M2 按 ATS 统计的准确率\n\n生成时间：${new Date().toISOString()}\n\n${renderAccuracyTable(rows)}`);
console.log(`${rows.length} row(s) -> ${path.relative(ROOT, out)}`);

const short = phoneShortfalls(rows);
for (const s of short) {
  if (s.why === 'below') {
    console.error(
      `phone below ${PHONE_FLOOR * 100}% of desktop: ${s.phone} ${s.phoneRate}% vs ${s.desktop} ${s.desktopRate}% (${s.mode}), ratio ${Math.round(1000 * (s.ratio ?? 0)) / 10}%`,
    );
  } else {
    const why = s.why === 'no_desktop' ? 'no desktop capture of its page' : 'several desktop captures of its page';
    console.error(`phone capture with ${why}, so the ${PHONE_FLOOR * 100}% rule cannot be checked: ${s.phone} (${s.mode})`);
  }
}
if (short.some(blocksAcceptance)) process.exitCode = 1;
