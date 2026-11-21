// Loading and scoring of real-page samples in fixtures/captured/<ats>/<name>/ (never committed).
// A sample takes part once a hand-written expected.json sits next to the capture.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { FillReport } from '../../src/engine/types';
import { DEFAULT_LOCALE, parseDevice, type CaptureDevice } from '../../scripts/capture/device.ts';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const CAPTURED_DIR = path.join(ROOT, 'fixtures', 'captured');
export const ACCURACY_FILE = path.join(ROOT, 'test-results', 'captured-accuracy.json');

export interface CapturedField {
  /** Finds the control(s); open shadow roots are searched too. */
  selector: string;
  /** Exact expected reading. Files and multi-checkboxes read as arrays. */
  expect?: unknown;
  /** Instead of `expect`, when the exact format is the site's business, e.g. a formatted phone number. */
  contains?: string;
  /**
   * Instead of `expect`, for what a site shows once it took the value. Some upload widgets remove the file
   * input and show progress instead, so `selector` names any element, not a control, and must match one.
   */
  exists?: true;
  /**
   * The control this field is about, when `selector` reads something else: with `exists`, or where the page
   * keeps what it took outside the box, as an upload widget that swaps its file box for an empty one.
   */
  control?: string;
  /** Checked on the static snapshot: the classification this control must get. */
  fieldKey?: string;
  /** Not a field of its own: the page changes it when another one is filled. It must show this, with no report row. */
  follows?: true;
  /** On an entry the fill adds: the page before the fill has no such control to judge. Replays still check it. */
  added?: true;
  /**
   * The control keeps its answer as text with no input behind it (a date on wheels): `selector` names the boxes
   * showing it, read as their text, two of them as a start and an end joined by ' ~ '.
   */
  shown?: true;
  /** Only the running page shows what this box is, by a value a snapshot does not keep. Replays still check it. */
  liveOnlyKey?: true;
  /**
   * A list that takes several, holding the resume's answers it offers while others are not on it. The ticks stay,
   * and the report row must say needs_review so the applicant hears of the rest.
   */
  partial?: true;
}

export interface LocatedEntry {
  selector: string;
}

/** Keeps what the field should hold, so moving it back to `fields` is a small edit. */
export interface KnownGap extends CapturedField {
  reason: string;
  /** Answers come from a search service a replay does not have: a gap in a replay, a field on the live page. */
  live?: true;
}

/** A control that is right to leave alone. Every control on a sample's page needs a verdict. */
export interface LeaveEmpty extends LocatedEntry {
  reason: string;
  /** The field this really is, when the resume just has nothing for it. Any other key is a wrong guess. */
  fieldKey?: string;
}

/**
 * Must stay empty and be reported needs_review / no_option. The regex matches the report row's label. `shown` and
 * `added` mean what they do on a `CapturedField`.
 */
export interface ReviewEntry extends LocatedEntry, Pick<CapturedField, 'shown' | 'added'> {
  labelRe: string;
  /** The row's resume path, as `work[1].period`, when entries of a section put several rows under one label. */
  source?: string;
}

export interface CapturedExpected {
  __resume: string;
  __adapter?: string;
  __review?: Record<string, ReviewEntry>;
  /** Report rows whose label matches may never be `filled`. */
  __traps?: string[];
  /** Not filled yet. They must stay empty and count as not correct. */
  __knownGaps?: Record<string, KnownGap>;
  /** Must equal the number of gaps: fixing one forces this number down, adding one needs a deliberate edit. */
  __knownGapsMax: number;
  /** Must not change, and may not be reported filled. */
  __leaveEmpty?: Record<string, LeaveEmpty>;
  /** A banner the applicant answers first, which covers the FAB. Clicked in the replay only, where nothing leaves. */
  __banner?: string;
  /**
   * A step form that keeps every step on the page and hides all but the one showing (Moka on a phone): the boxes of
   * its steps. The static checks show them all, so each control is judged as it will be once its step comes up.
   */
  __hiddenSteps?: string;
  /** Must equal the number of wrong guesses, as with `__knownGapsMax`. */
  __wrongGuessesMax?: number;
  fields: Record<string, CapturedField>;
  /** Entries a page keeps in a list once saved, in the order shown. Each has to show all its texts. */
  __entries?: Record<string, { selector: string; section: string; shows: string[][] }>;
}

export interface CapturedSample {
  ats: string;
  name: string;
  dir: string;
  url: string;
  /** Read in place behind a login, so there is no recording to replay: it runs on its snapshot. */
  readInPlace: boolean;
  /** Replayed on the same device and locale it was captured with. */
  device: CaptureDevice;
  locale: string;
  expected: CapturedExpected;
}

/** Every sample with an expected.json. Captures without one are not ready yet and are left out. */
export function listSamples(root: string = CAPTURED_DIR): CapturedSample[] {
  if (!existsSync(root)) return [];
  const out: CapturedSample[] = [];
  for (const ats of readdirSync(root)) {
    const atsDir = path.join(root, ats);
    for (const name of existsSync(atsDir) ? readdirSync(atsDir) : []) {
      const dir = path.join(atsDir, name);
      const file = path.join(dir, 'expected.json');
      if (!existsSync(file)) continue;
      const meta = JSON.parse(readFileSync(path.join(dir, 'meta.json'), 'utf8')) as {
        url: string;
        harEntries?: number;
        device?: string;
        locale?: string;
      };
      out.push({
        ats,
        name,
        dir,
        url: meta.url,
        readInPlace: meta.harEntries === 0,
        // Captures from before these were recorded were all desktop, in en-AU.
        device: parseDevice(meta.device),
        locale: meta.locale ?? DEFAULT_LOCALE,
        expected: JSON.parse(readFileSync(file, 'utf8')) as CapturedExpected,
      });
    }
  }
  return out;
}

// ------------------------------------------------------------------------------------------ scoring

export type Reading = string | boolean | string[] | null;

export interface ControlChange {
  key: string;
  before: string;
  after: string;
}

export interface Inspection {
  /** Control key → value, for every control on the page. */
  snapshot: Record<string, string>;
  /** Locator name → what the control holds now. Null: the selector found nothing. */
  readings: Record<string, Reading>;
  /** Locator name → the control keys its selector covers. */
  coverage: Record<string, string[]>;
}

export interface WrongField {
  label: string;
  expected: unknown;
  actual: Reading;
}

export interface SampleScore {
  sample: string;
  mode: string;
  /** Rows written before this was recorded are desktop. */
  device: CaptureDevice;
  /** The page the sample was captured from: a phone and a desktop capture of one page are compared. */
  url?: string;
  /** From the click to the last field, as the fill itself reports it. */
  fillMs: number;
  fields: number;
  correct: number;
  /** Stayed empty although a value was expected. */
  missing: string[];
  /** Holds something else than expected. Never acceptable. */
  wrong: WrongField[];
  /** Changed although nothing in `fields` covers them. Never acceptable. */
  extras: ControlChange[];
  gaps: string[];
  /** Gaps counted as fields because this run was on the live page. */
  liveFields: number;
  /** A selector that no longer finds anything: the page changed or the sample is stale. */
  stale: string[];
  trapsFilled: string[];
  reviewProblems: string[];
  /**
   * Correct fields the fill only reached once the replay showed the steps the page held back (`__hiddenSteps`), playing
   * an applicant who answered what no resume does. Counted in `correct`, and named so that share stays visible.
   */
  revealedOnly?: string[];
  /** The report says filled but read nothing back. The report must not claim what it cannot see. */
  falselyFilled: string[];
  /** The page holds the right value, yet the report says otherwise. A user would redo work that is done. */
  falselyFailed: string[];
  leaveEmpty: number;
  /** Should have stayed empty, and did not. */
  touched: string[];
  /**
   * A control with no such field that the engine still named a field for. Nothing was filled, but the user is
   * shown a nonsense suggestion, and a higher score would have filled it.
   */
  wrongGuesses: string[];
  outcomes: FillReport['counts'];
}

export const isEmptyReading = (r: Reading): boolean => r === null || r === '' || r === false || (Array.isArray(r) && r.length === 0);

function matches(field: CapturedField, actual: Reading): boolean {
  if (field.exists) return actual === true;
  if (field.contains !== undefined) return typeof actual === 'string' && actual.includes(field.contains);
  return JSON.stringify(actual) === JSON.stringify(field.expect);
}

const squashLabel = (s: string): string => s.replace(/[*\s]+/g, ' ').trim().toLowerCase();

/** The report's row for a field: by field key, or else by its label. A filled row wins over a later failed one. */
function rowsOf(report: FillReport, label: string, fieldKey?: string): FillReport['fields'] {
  const wanted = squashLabel(label);
  return report.fields.filter((f) => {
    if (fieldKey && f.fieldKey === fieldKey) return true;
    return squashLabel(f.label ?? '').includes(wanted);
  });
}

/** Every selector that gives a control on the page its verdict. */
export function verdictSelectors(expected: CapturedExpected): string[] {
  const of = (f: CapturedField): string[] => {
    if (f.added) return [];
    if (f.control) return [f.control];
    return f.exists || f.follows ? [] : [f.selector];
  };
  return [
    ...Object.values(expected.fields).flatMap(of),
    ...Object.values(expected.__knownGaps ?? {}).flatMap(of),
    ...Object.values(expected.__review ?? {}).flatMap((r) => (r.added ? [] : [r.selector])),
    ...Object.values(expected.__leaveEmpty ?? {}).map((r) => r.selector),
  ];
}

export function changedControls(before: Inspection['snapshot'], after: Inspection['snapshot']): ControlChange[] {
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const out: ControlChange[] = [];
  for (const key of keys) {
    const b = before[key] ?? '';
    const a = after[key] ?? '';
    if (a !== b) out.push({ key, before: b, after: a });
  }
  return out;
}

/**
 * Controls with no id or name are keyed by their order (`checkbox=~2`), so one the fill adds, on an entry it adds,
 * moves the numbers of those after it. Such a group is forgiven only when it grew, and the values nothing covers,
 * read in order, are the ones from before with only empty controls slipped in between. A tick that moved from one
 * box to another is still a change.
 */
function withoutRenumbering(changes: ControlChange[], before: Inspection['snapshot'], after: Inspection['snapshot'], covered: Set<string>): ControlChange[] {
  const base = (key: string): string => key.replace(/~\d+$/, '');
  const ordinal = (key: string): number => Number(/~(\d+)$/.exec(key)?.[1] ?? 0);
  const keysOf = (snapshot: Inspection['snapshot'], of: string): string[] =>
    Object.keys(snapshot)
      .filter((key) => base(key) === of)
      .sort((a, b) => ordinal(a) - ordinal(b));
  const valuesOf = (snapshot: Inspection['snapshot'], of: string): string[] =>
    keysOf(snapshot, of)
      .filter((key) => !covered.has(key))
      .map((key) => snapshot[key] ?? '');
  /** `was` read in order inside `now`, where whatever `now` holds besides is empty. */
  const onlyEmptiesAdded = (was: string[], now: string[]): boolean => {
    let i = 0;
    for (const value of now) {
      if (i < was.length && value === was[i]) i++;
      else if (value !== '') return false;
    }
    return i === was.length;
  };
  const moved = new Set(
    [...new Set(changes.map((c) => base(c.key)))].filter(
      (of) => keysOf(after, of).length > keysOf(before, of).length && onlyEmptiesAdded(valuesOf(before, of), valuesOf(after, of)),
    ),
  );
  return changes.filter((c) => !moved.has(base(c.key)));
}

/**
 * `reached`: the page as the fill left it before the replay showed the steps the page held back, when it did. A field
 * right in the end but not there is one the fill only reached through that stand-in.
 */
export function scoreSample(
  sample: { ats: string; name: string; expected: CapturedExpected; device?: CaptureDevice; url?: string },
  mode: string,
  before: Inspection,
  after: Inspection,
  report: FillReport,
  reached?: Inspection,
): SampleScore {
  const { expected } = sample;
  const missing: string[] = [];
  const wrong: WrongField[] = [];
  const stale: string[] = [];
  const falselyFailed: string[] = [];
  const revealedOnly: string[] = [];
  let correct = 0;

  const allGaps = Object.entries(expected.__knownGaps ?? {});
  const liveFields = mode === 'live' ? allGaps.filter(([, gap]) => gap.live) : [];
  const checked: Record<string, CapturedField> = { ...expected.fields, ...Object.fromEntries(liveFields) };

  for (const [label, field] of Object.entries(checked)) {
    const actual = after.readings[label] ?? null;
    if (matches(field, actual)) {
      correct++;
      if (reached && !matches(field, reached.readings[label] ?? null)) revealedOnly.push(label);
      const rows = rowsOf(report, label, field.fieldKey);
      if (field.follows) continue;
      if (rows.length === 0) falselyFailed.push(`${label}: no report row`);
      else if (field.partial) {
        if (!rows.some((r) => r.outcome === 'needs_review')) falselyFailed.push(`${label}: reported ${rows[0]!.outcome}, not needs_review`);
      } else if (!rows.some((r) => r.outcome === 'filled')) falselyFailed.push(`${label}: reported ${rows[0]!.outcome}`);
    } else if (isEmptyReading(actual)) missing.push(label);
    else wrong.push({ label, expected: field.contains ? `contains ${field.contains}` : field.expect, actual });
    if (!field.exists && (after.coverage[label] ?? []).length === 0) stale.push(label);
  }

  let entryTexts = 0;
  for (const [label, { section, shows }] of Object.entries(expected.__entries ?? {})) {
    const reading = after.readings[label];
    const saved = Array.isArray(reading) ? reading : [];
    let right = true;
    if (saved.length > shows.length) {
      wrong.push({ label: `${label}: ${saved.length} entries, expected ${shows.length}`, expected: shows.length, actual: String(saved.length) });
      right = false;
    }
    shows.forEach((texts, i) => {
      for (const text of texts) {
        entryTexts++;
        const name = `${label} ${i + 1}: ${text}`;
        if (saved[i]?.includes(text)) correct++;
        else {
          right = false;
          if (saved[i] === undefined) missing.push(name);
          else wrong.push({ label: name, expected: `contains ${text}`, actual: saved[i] });
        }
      }
    });
    const row = report.fields.find((f) => f.fieldId === `section:${section}` && f.outcome === 'action_failed');
    if (right && row) falselyFailed.push(`${row.fieldId}: reported ${row.outcome}`);
  }

  // A field the page rebuilt under a new id was covered under its old one, which no control holds any more.
  const gone = (key: string): boolean => !(key in after.snapshot);
  const covered = new Set(Object.keys(checked).flatMap((label) => [...(before.coverage[label] ?? []).filter(gone), ...(after.coverage[label] ?? [])]));
  const extras = withoutRenumbering(
    changedControls(before.snapshot, after.snapshot).filter((c) => !covered.has(c.key)),
    before.snapshot,
    after.snapshot,
    covered,
  );

  const gaps = allGaps.filter(([label]) => !(label in checked)).map(([label]) => label);
  for (const label of [...gaps, ...Object.keys(expected.__review ?? {})]) {
    if ((after.coverage[label] ?? []).length === 0) stale.push(label);
  }

  const trapsFilled = (expected.__traps ?? []).flatMap((re) => {
    const regex = new RegExp(re, 'i');
    return report.fields.filter((f) => f.outcome === 'filled' && regex.test(f.label)).map((f) => f.label);
  });

  const reviewProblems = Object.entries(expected.__review ?? {}).flatMap(([label, entry]) => {
    const problems: string[] = [];
    if (!isEmptyReading(after.readings[label] ?? null)) problems.push(`${label}: not empty`);
    const regex = new RegExp(entry.labelRe, 'i');
    const row = report.fields.find((f) => regex.test(f.label) && (entry.source === undefined || f.source === entry.source));
    if (!row) problems.push(`${label}: no report row`);
    else if (row.outcome !== 'needs_review' && row.outcome !== 'no_option') problems.push(`${label}: reported ${row.outcome}`);
    return problems;
  });

  const leaving = Object.keys(expected.__leaveEmpty ?? {});
  const touched = leaving.filter((label) => {
    const changed = JSON.stringify(after.readings[label] ?? null) !== JSON.stringify(before.readings[label] ?? null);
    return changed || rowsOf(report, label).some((r) => r.outcome === 'filled');
  });

  const named: [string, string | undefined][] = [
    ...Object.entries(expected.__leaveEmpty ?? {}).map(([label, e]): [string, string | undefined] => [label, e.fieldKey]),
    ...allGaps.map(([label, g]): [string, string | undefined] => [label, g.fieldKey]),
  ];
  const wrongGuesses = named.flatMap(([label, right]) =>
    rowsOf(report, label)
      .filter((r) => r.fieldKey && r.fieldKey !== right)
      .map((r) => `${label}: ${r.fieldKey}`),
  );

  return {
    fillMs: report.finishedAt - report.startedAt,
    sample: `${sample.ats}/${sample.name}`,
    mode,
    device: sample.device ?? 'desktop',
    ...(sample.url ? { url: sample.url } : {}),
    fields: Object.keys(checked).length + entryTexts,
    liveFields: liveFields.length,
    correct,
    missing,
    wrong,
    extras,
    gaps,
    stale,
    trapsFilled,
    reviewProblems,
    revealedOnly,
    falselyFilled: report.fields.filter((f) => f.outcome === 'filled' && !f.observed && !/^(true|false)$/.test(f.value ?? '')).map((f) => f.label),
    falselyFailed,
    leaveEmpty: leaving.length,
    touched,
    wrongGuesses,
    outcomes: report.counts,
  };
}

/** Everything that must be true for a sample to pass. Empty means it passed. */
export function scoreProblems(score: SampleScore, expected: CapturedExpected): string[] {
  const out: string[] = [];
  for (const w of score.wrong) out.push(`wrong ${w.label}: expected ${JSON.stringify(w.expected)}, got ${JSON.stringify(w.actual)}`);
  for (const c of score.extras) out.push(`unexpected change ${c.key}: ${JSON.stringify(c.before)} -> ${JSON.stringify(c.after)}`);
  for (const label of score.missing) out.push(`missing ${label}`);
  for (const label of score.stale) out.push(`stale selector ${label}`);
  for (const label of score.trapsFilled) out.push(`trap filled: ${label}`);
  out.push(...score.reviewProblems);
  for (const label of score.falselyFilled) out.push(`reported filled with nothing read back: ${label}`);
  for (const row of score.falselyFailed) out.push(`false report ${row}`);
  for (const label of score.touched) out.push(`should stay empty: ${label}`);
  const allowed = expected.__wrongGuessesMax ?? 0;
  if (score.wrongGuesses.length !== allowed) {
    out.push(`wrong guesses: ${score.wrongGuesses.length}, but __wrongGuessesMax is ${allowed} (${score.wrongGuesses.join('; ')})`);
  }
  if (score.gaps.length + score.liveFields !== expected.__knownGapsMax) {
    out.push(`known gaps: ${score.gaps.length + score.liveFields}, but __knownGapsMax is ${expected.__knownGapsMax}. Gaps may only shrink, and the number moves with them`);
  }
  return out;
}

/** Gaps count against the sample: a field we cannot fill yet is not a correct field. */
export function accuracyOf(score: Pick<SampleScore, 'fields' | 'correct' | 'gaps'>): number {
  const total = score.fields + score.gaps.length;
  return total === 0 ? 0 : Math.round((1000 * score.correct) / total) / 10;
}

/** Merged by sample and mode: Playwright empties test-results at the start of a run. */
export function recordScore(score: SampleScore, file: string = ACCURACY_FILE): void {
  mkdirSync(path.dirname(file), { recursive: true });
  let rows: SampleScore[] = [];
  try {
    rows = JSON.parse(readFileSync(file, 'utf8')) as SampleScore[];
  } catch {
    /* first sample of the run */
  }
  rows = [...rows.filter((r) => r.sample !== score.sample || r.mode !== score.mode), score];
  writeFileSync(file, JSON.stringify(rows, null, 2));
}

const wrongCount = (r: SampleScore): number => r.wrong.length + r.extras.length;
const falseReports = (r: SampleScore): number => r.falselyFilled.length + r.falselyFailed.length;

/** The phone fill rate a page needs, as a share of the desktop fill rate of the same page. */
export const PHONE_FLOOR = 0.9;

const deviceOf = (r: SampleScore): CaptureDevice => r.device ?? 'desktop';
const totalOf = (r: SampleScore): number => r.fields + r.gaps.length;
const percent = (x: number): string => `${Math.round(1000 * x) / 10}%`;

/** Hosts that send a phone to the same path under /m/: the ones the Moka adapter claims (src/adapters/cnPortals.ts). */
const PHONE_UNDER_M = /(?:^|\.)mokahr\.com$/;

/**
 * Host and path: a phone capture of a page often lands on it with another query or fragment, and Moka sends a phone
 * to the same path under /m/. On any other site /m/ may be another page, so it stays.
 */
function pageUrl(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const route = PHONE_UNDER_M.test(host) ? u.pathname.replace(/^\/m(?=\/)/, '') : u.pathname;
    return `${u.host.toLowerCase()}${route.replace(/\/+$/, '')}`;
  } catch {
    return url;
  }
}

/** One page in one run mode. */
const pageOf = (r: SampleScore): string => `${r.sample.split('/')[0]} ${r.url ? pageUrl(r.url) : r.sample} ${r.mode}`;

type NoPartner = 'no_desktop' | 'several_desktops';
type Partner = { desktop: SampleScore } | { why: NoPartner };

/** The desktop capture each phone capture is held against, or why there is none to hold it against. */
function partners(rows: SampleScore[]): Map<SampleScore, Partner> {
  const desktops = new Map<string, SampleScore[]>();
  for (const r of rows) {
    if (deviceOf(r) === 'desktop') desktops.set(pageOf(r), [...(desktops.get(pageOf(r)) ?? []), r]);
  }
  const out = new Map<SampleScore, Partner>();
  for (const r of rows) {
    if (deviceOf(r) !== 'mobile') continue;
    const found = desktops.get(pageOf(r)) ?? [];
    out.set(r, found.length === 1 ? { desktop: found[0]! } : { why: found.length ? 'several_desktops' : 'no_desktop' });
  }
  return out;
}

/** phone rate ÷ desktop rate; undefined when the desktop filled nothing. */
function phoneRatio(desktop: SampleScore, phone: SampleScore): number | undefined {
  if (desktop.correct === 0 || totalOf(phone) === 0) return undefined;
  return (phone.correct * totalOf(desktop)) / (totalOf(phone) * desktop.correct);
}

export interface PhoneShortfall {
  phone: string;
  desktop: string | null;
  mode: string;
  phoneRate: number;
  desktopRate: number | null;
  ratio: number | null;
  /** `below`: under PHONE_FLOOR. Otherwise there is no single desktop capture of the page to hold it against. */
  why: 'below' | NoPartner;
}

/**
 * Phone captures that fill less than PHONE_FLOOR of the desktop capture of the same page and run mode, and phone
 * captures the rule cannot be checked on because that desktop capture is missing or not the only one.
 */
export function phoneShortfalls(rows: SampleScore[]): PhoneShortfall[] {
  return [...partners(rows)].flatMap(([phone, p]): PhoneShortfall[] => {
    const own = { phone: phone.sample, mode: phone.mode, phoneRate: accuracyOf(phone) };
    if (!('desktop' in p)) return [{ ...own, desktop: null, desktopRate: null, ratio: null, why: p.why }];
    const ratio = phoneRatio(p.desktop, phone) ?? 1;
    if (ratio >= PHONE_FLOOR) return [];
    return [{ ...own, desktop: p.desktop.sample, desktopRate: accuracyOf(p.desktop), ratio, why: 'below' }];
  });
}

const NO_RATIO: Record<NoPartner, string> = { no_desktop: '无电脑版', several_desktops: '电脑版不止一个' };

/**
 * The per-ATS table for the local acceptance report: one row per capture and run mode, each phone capture right
 * under the desktop capture of its page. 代答后才填 counts the right fields the fill reached only once the replay showed
 * steps the page held back for answers no resume gives (`revealedOnly`). The last two columns hold a phone fill rate
 * and its share of the desktop rate: on a desktop row, its worst phone's.
 */
export function renderAccuracyTable(rows: SampleScore[]): string {
  const paired = partners(rows);
  const phonesOf = new Map<SampleScore, SampleScore[]>();
  for (const [phone, p] of paired) if ('desktop' in p) phonesOf.set(p.desktop, [...(phonesOf.get(p.desktop) ?? []), phone]);
  const ratioCell = (x: number | undefined): string => (x === undefined ? '—' : percent(x));
  const line = (r: SampleScore, phoneRate: string, ratio: string): string =>
    `| ${r.sample} | ${deviceOf(r) === 'mobile' ? '手机' : '电脑'} | ${r.mode} | ${totalOf(r)} | ${r.correct} | ${accuracyOf(r)}% | ${r.revealedOnly?.length ?? 0} | ${wrongCount(r)} | ${r.missing.length + r.gaps.length} | ${r.gaps.length} | ${falseReports(r)} | ${r.leaveEmpty} | ${r.touched.length} | ${r.wrongGuesses.length} | ${r.outcomes.needs_review} | ${r.outcomes.action_failed} | ${(r.fillMs / 1000).toFixed(1)} | ${phoneRate} | ${ratio} |`;

  const body = rows.map((r) => {
    if (deviceOf(r) === 'mobile') {
      const p = paired.get(r)!;
      const anchor = 'desktop' in p ? p.desktop : r;
      const ratio = 'desktop' in p ? ratioCell(phoneRatio(p.desktop, r)) : NO_RATIO[p.why];
      return { key: [anchor.sample, anchor.mode, '1', r.sample], line: line(r, `${accuracyOf(r)}%`, ratio) };
    }
    const worst = [...(phonesOf.get(r) ?? [])].sort((a, b) => accuracyOf(a) - accuracyOf(b))[0];
    const cells = worst ? line(r, `${accuracyOf(worst)}%`, ratioCell(phoneRatio(r, worst))) : line(r, '—', '—');
    return { key: [r.sample, r.mode, '0', r.sample], line: cells };
  });
  body.sort((a, b) => {
    for (let i = 0; i < a.key.length; i++) {
      const c = a.key[i]! < b.key[i]! ? -1 : a.key[i]! > b.key[i]! ? 1 : 0;
      if (c) return c;
    }
    return 0;
  });
  const lines = [
    '| 样本 | 设备 | 运行方式 | 应填 | 填对 | 填对率 | 代答后才填 | 错填 | 漏填 | 其中已知 | 误报 | 应留空 | 动了应留空 | 错认字段 | 待确认 | 操作失败 | 耗时（秒） | 手机填对率 | 手机/电脑 |',
    '|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|',
    ...body.map((b) => b.line),
  ];
  return `${lines.join('\n')}\n`;
}

/** One line per sample and mode, printed by the specs and used for the accuracy table. */
export function scoreLine(score: SampleScore): string {
  const revealed = score.revealedOnly?.length ? ` (${score.revealedOnly.length} only once the held-back steps were shown)` : '';
  return `[captured] ${score.sample} (${score.mode}): ${score.correct}/${score.fields + score.gaps.length} = ${accuracyOf(score)}%${revealed}, wrong ${wrongCount(score)}, missing ${score.missing.length + score.gaps.length} (${score.gaps.length} known), false reports ${falseReports(score)}, left empty ${score.leaveEmpty - score.touched.length}/${score.leaveEmpty}, wrong guesses ${score.wrongGuesses.length}, took ${(score.fillMs / 1000).toFixed(1)}s`;
}
