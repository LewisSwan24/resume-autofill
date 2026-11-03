// Read-back comparison shared by drivers (via execute.ts re-export). Kept in its own module so
// native.ts can use it without creating an execute → registry → native → execute import cycle.

const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;

function norm(s: string): string {
  return s.normalize('NFKC').replace(INVISIBLE, '').replace(/\s+/g, ' ').trim().toLowerCase();
}

// 2020-09 · 2020-09-01 · 2020/9/1 · 2020.09 · 2020年9月 · 2020年9月1日
const DATE_RE = /^(\d{4})\s*[-/.年]\s*(\d{1,2})(?:\s*月\s*(?:(\d{1,2})\s*日?)?|\s*[-/.]\s*(\d{1,2})\s*日?)?$/;

function dateParts(s: string): string[] | null {
  const m = DATE_RE.exec(s);
  if (!m) return null;
  const parts = [m[1]!, m[2]!.padStart(2, '0')];
  const day = m[3] ?? m[4];
  if (day) parts.push(day.padStart(2, '0'));
  return parts;
}

/**
 * Does what a control shows (`observed`) amount to what we intended to write (`expected`)?
 * Whitespace-, case- and width-insensitive; dates compare their digits, so `2020-09`,
 * `2020/9` and `2020年9月` are equivalent. `null` (nothing observable) never matches.
 */
export function valuesEquivalent(expected: string, observed: string | null): boolean {
  if (observed === null) return false;
  const a = norm(expected);
  const b = norm(observed);
  if (a === b) return true;
  const da = dateParts(a);
  const db = dateParts(b);
  if (da && db) return da.length === db.length && da.every((p, i) => p === db[i]);
  return false;
}
