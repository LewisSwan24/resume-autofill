// Shared by tests/drivers/runfill.spec.ts (no extension) and tests/e2e/fill.spec.ts (extension loaded):
// how a fixture's expected.json is split, compared and which controls are review fields / traps.
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const FIXTURES_DIR = path.join(ROOT, 'fixtures', 'synthetic');

export type State = Record<string, unknown>;

/** `__resume` / `__review` meta keys are separated from the per-field expected state. */
export function loadExpected(name: string): { meta: State; state: State } {
  const raw = JSON.parse(readFileSync(path.join(FIXTURES_DIR, name, 'expected.json'), 'utf8')) as State;
  const meta: State = {};
  const state: State = {};
  for (const [k, v] of Object.entries(raw)) (k.startsWith('__') ? meta : state)[k] = v;
  return { meta, state };
}

/** Empty value of the same shape: '' / false / []. */
export function emptyLike(v: unknown): unknown {
  return Array.isArray(v) ? [] : typeof v === 'boolean' ? false : '';
}

export const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

export interface FixtureSpec {
  name: 'native' | 'antd' | 'element' | 'aria' | 'questions-zh' | 'questions-en';
  /** Review field state key → the label its control is reported under. */
  review: Record<string, RegExp>;
  /** Controls that must never be reported as filled. */
  traps: RegExp[];
  /** Labels that must appear in the report (form-item labels, not wrapped option labels). */
  labels?: RegExp[];
  /** Page-level fixtures with an iframe: the fill runs in the frame as well. */
  frame?: boolean;
}

export const FIXTURE_SPECS: FixtureSpec[] = [
  {
    name: 'native',
    review: { preferredLocation: /preferred location/i },
    traps: [/verification code/i, /privacy policy/i],
    frame: true,
  },
  { name: 'antd', review: { foreignLanguage: /外语语种/ }, traps: [/推荐人工号/] },
  { name: 'element', review: {}, traps: [], labels: [/^是否接受外派$/, /^是否在职$/] },
  {
    name: 'aria',
    review: { currentLocation: /current location/i, visaType: /visa type/i },
    traps: [/privacy policy/i, /autofill from resume/i],
  },
  { name: 'questions-zh', review: {}, traps: [/推荐人工号/, /推荐码/] },
  { name: 'questions-en', review: {}, traps: [/referral code/i, /video call/i] },
];

export interface KeyRow {
  key: string;
  ok: boolean;
  expected: unknown;
  actual: unknown;
}

/** Compare the live fixture state to expected.json key by key. */
export function compareState(state: State, expected: State): { rows: KeyRow[]; extra: string[]; good: number } {
  const rows = Object.keys(expected).map((key) => ({
    key,
    ok: same(state[key], expected[key]),
    expected: expected[key],
    actual: state[key],
  }));
  return {
    rows,
    extra: Object.keys(state).filter((k) => !(k in expected)),
    good: rows.filter((r) => r.ok).length,
  };
}
