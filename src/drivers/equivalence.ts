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

const PHONE_RE = /^\+?[\d\s()./-]+$/;
const MIN_PHONE_DIGITS = 8;
const MAX_DIAL_CODE_DIGITS = 3;

/** Phone widgets format as they write, and may put the dial code in place of the trunk 0. */
function samePhone(expected: string, observed: string): boolean {
  if (!PHONE_RE.test(expected) || !PHONE_RE.test(observed)) return false;
  const want = expected.replace(/\D/g, '');
  const got = observed.replace(/\D/g, '');
  if (want.length < MIN_PHONE_DIGITS) return false;
  if (want === got) return true;
  if (!want.startsWith('0') || !observed.startsWith('+')) return false;
  const national = want.slice(1);
  const extra = got.length - national.length;
  return extra >= 1 && extra <= MAX_DIAL_CODE_DIGITS && got.endsWith(national);
}

/**
 * Does what a control shows (`observed`) amount to what we intended to write (`expected`)?
 * Whitespace-, case- and width-insensitive; dates compare their digits, so `2020-09`,
 * `2020/9` and `2020年9月` are equivalent, and phone numbers compare their digits. `null` (nothing observable) never matches.
 */
export function valuesEquivalent(expected: string, observed: string | null): boolean {
  if (observed === null) return false;
  const a = norm(expected);
  const b = norm(observed);
  if (a === b) return true;
  const da = dateParts(a);
  const db = dateParts(b);
  if (da && db) return da.length === db.length && da.every((p, i) => p === db[i]);
  if (da || db) return false;
  return samePhone(a, b);
}
