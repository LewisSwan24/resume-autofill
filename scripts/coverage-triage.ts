// Writes the triage of every control on the captured sample pages, from the last `pnpm test:captured` run, into the
// local acceptance docs. Exits non-zero while a control has no category or an unfilled report row no entry covers.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { renderTriage, TRIAGE_FILE, triageCounts, type TriageRow } from '../tests/shared/coverageTriage.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(ROOT, 'docs', 'reviews', 'coverage-triage.md');
const rows = JSON.parse(readFileSync(TRIAGE_FILE, 'utf8')) as TriageRow[];
const samples = new Set(rows.map((r) => r.sample)).size;
mkdirSync(path.dirname(out), { recursive: true });
writeFileSync(out, `# 回放样本的栏位归类\n\n生成时间：${new Date().toISOString()}，样本 ${samples} 个。\n\n${renderTriage(rows)}`);
console.log(`${samples} sample(s), ${rows.length} row(s) -> ${path.relative(ROOT, out)}`);

const counts = triageCounts(rows);
if (counts.orphan || counts.untagged) {
  console.error(`not every control is sorted: ${counts.orphan ?? 0} orphan report row(s), ${counts.untagged ?? 0} untagged entr(ies)`);
  process.exitCode = 1;
}
