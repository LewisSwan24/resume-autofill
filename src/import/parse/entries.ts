// Education, jobs and projects: a date range marks each entry, and the words around it say what is what.
import { OPTION_SYNONYMS } from '../../dictionary';
import { normalizeLabel, toSimplified } from '../../dictionary/normalize';
import type { TextLine } from '../extract/types';
import { findDateRange, type DateRange } from './dates';
import type { DraftField } from './types';

const BULLET = /^[\s•·●▪■◦\-–—*]+/;
const SCHOOL_WORDS = /(?:大学|学院|学校|中学|高中|university|institute|college|school|academy|polytechnic|tafe)/i;
const COMPANY_WORDS = /(?:公司|集团|有限|银行|医院|研究院|工作室|事务所|\bpty\b|\bltd\b|\binc\b|\bllc\b|\bcorp\b|\bgmbh\b|\bgroup\b|\bstudio\b|\bagency\b|\bbank\b|\bconsulting\b|\bnetworks?\b|\blogistics\b|\bfreight\b|\bsoftware\b|\btechnolog(?:y|ies)\b|\bsolutions\b|\bsystems\b|\blabs?\b|\bpartners\b)/i;
const TITLE_WORDS = /(?:工程师|经理|总监|主管|专员|助理|设计师|分析师|顾问|实习生|负责人|开发|架构师|产品|运营|\bengineer\b|\bdeveloper\b|\bmanager\b|\bdesigner\b|\banalyst\b|\bconsultant\b|\bintern\b|\bgraduate\b|\blead\b|\bdirector\b|\bofficer\b|\bcoordinator\b|\bassistant\b|\barchitect\b|\bspecialist\b|\bhead of\b|\bresearcher\b)/i;

/** Long, or ending as a sentence ends: what someone did there, and no name or title. */
const isProse = (t: string): boolean => /[。.；;]$/.test(t) || t.length > 60 || BULLET.test(t) || startsWithWhatWasDone(t);

const DID = /^(?:\p{Lu}\p{Ll}+ed|Led|Built|Ran|Won|Made|Wrote|Drove|Grew|Cut|Sold|Held|Taught|Began|Brought|Kept|Met|Set|Took)\s/u;
/** "Led the migration Mar 2019 - Jun 2019". A company can start the same way, and then it says so. */
function startsWithWhatWasDone(t: string): boolean {
  return DID.test(t) && !COMPANY_WORDS.test(t) && !TITLE_WORDS.test(t) && !SCHOOL_WORDS.test(t);
}

/** More than anyone has held. Past this a file is only trying to be slow. */
const MAX_ENTRIES = 40;
const MAX_SKILLS = 100;

function degreeIn(text: string): { code: string; matched: string } | null {
  const t = normalizeLabel(text);
  const groups = OPTION_SYNONYMS['degree'] ?? {};
  for (const code of ['phd', 'master', 'bachelor', 'associate', 'high_school']) {
    for (const syn of groups[code] ?? []) {
      const s = normalizeLabel(syn);
      if (!s) continue;
      const hit = /[a-z]/.test(s) ? new RegExp(`(?:^|[^a-z])${s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^a-z])`).test(t) : t.includes(s);
      if (hit) return { code, matched: syn };
    }
  }
  return null;
}

/** Pieces of the text beside the dates: cells, or comma-separated in a plain line. */
function piecesOf(line: TextLine, range: DateRange | null): string[] {
  const cells = line.cells.length > 1 ? line.cells : [line.text];
  const pieces = cells.flatMap((c) => {
    const inner = range ? (findDateRange(c)?.rest ?? c) : c;
    // A single space keeps "Bachelor of Design" whole and is all that stands between 虚构大学 and 硕士.
    return inner.split(/\s*[,，|｜]\s*|\s{2,}|　+|(?<=\p{Script=Han}) (?=\p{Script=Han})/u);
  });
  return pieces.map((p) => p.trim()).filter(Boolean);
}

interface Block {
  /** Lines of one entry, the one with the dates included. */
  lines: number[];
  anchor: number;
  range: DateRange;
}

/** Dates on an entry's first line, or on its last: the first date in the section says which this file does. */
function blocksOf(section: number[], all: TextLine[]): Block[] {
  const anchors = section.flatMap((i) => {
    // A date inside what someone did there is part of the story, and starts no new entry.
    if (isProse(all[i]!.text.trim())) return [];
    const range = findDateRange(all[i]!.text);
    return range ? [{ i, range }] : [];
  }).slice(0, MAX_ENTRIES);
  if (anchors.length === 0) return [];
  const datesLast = anchors[0]!.i !== section[0];
  return anchors.map(({ i, range }, n) => {
    if (datesLast) {
      const from = n === 0 ? section[0]! : anchors[n - 1]!.i + 1;
      return { lines: section.filter((x) => x >= from && x <= i), anchor: i, range };
    }
    const next = anchors[n + 1]?.i ?? Infinity;
    return { lines: section.filter((x) => x >= i && x < next), anchor: i, range };
  });
}

function datesOf(prefix: string, b: Block): DraftField[] {
  const beside = toSimplified(b.range.rest);
  // Dates on a line that names no employer, school or role could be the dates of anything.
  const certainty = b.range.monthGuessed || !(COMPANY_WORDS.test(beside) || TITLE_WORDS.test(beside) || SCHOOL_WORDS.test(beside)) ? 'check' : 'high';
  const out: DraftField[] = [{ path: `${prefix}.startDate`, value: b.range.start, certainty, line: b.anchor }];
  if (b.range.current) out.push({ path: `${prefix}.current`, value: 'true', certainty: 'high', line: b.anchor });
  else out.push({ path: `${prefix}.endDate`, value: b.range.end!, certainty, line: b.anchor });
  return out;
}

const check = (path: string, value: string, line: number): DraftField => ({ path, value, certainty: 'check', line });

export function readEducation(section: number[], all: TextLine[], start = 0): DraftField[] {
  return blocksOf(section, all).flatMap((b, n) => {
    const prefix = `education.${start + n}`;
    const out = datesOf(prefix, b);
    let school: string | null = null;
    let degree: string | null = null;
    let major: string | null = null;
    for (const i of b.lines) {
      const line = all[i]!;
      if (i !== b.anchor && isProse(line.text)) continue;
      for (const piece of piecesOf(line, i === b.anchor ? b.range : null)) {
        const found = degreeIn(piece);
        // "Bachelor of Design" gives both, "本科" gives one, and a school can hold a degree's word without being one.
        if (!school && SCHOOL_WORDS.test(toSimplified(piece))) {
          school = piece;
          out.push(check(`${prefix}.school`, piece, i));
          continue;
        }
        if (found && !degree) {
          degree = found.code;
          out.push(check(`${prefix}.degree`, found.code, i));
          // "Bachelor of Design", or a subject written before its degree: "计算机科学与技术 本科".
          const before = piece.slice(0, piece.toLowerCase().indexOf(found.matched.toLowerCase())).trim();
          const subject = /\bof\s+(.+)$/i.exec(piece)?.[1]?.trim() || before;
          if (subject && !major) {
            major = subject;
            out.push(check(`${prefix}.major`, major, i));
          }
          continue;
        }
        if (!major && !found && !/^\d/.test(piece)) {
          // A subject and a degree written as one: "计算机科学与技术　本科" was already split on the space.
          major = piece;
          out.push(check(`${prefix}.major`, piece, i));
        }
      }
    }
    return out;
  });
}

export function readJobs(section: number[], all: TextLine[], start: number, kind: 'full_time' | 'internship'): DraftField[] {
  return blocksOf(section, all).flatMap((b, n) => {
    const prefix = `work.${start + n}`;
    const out = datesOf(prefix, b);
    if (kind === 'internship') out.push({ path: `${prefix}.kind`, value: 'internship', certainty: 'high', line: b.anchor });
    const pieces: { text: string; line: number }[] = [];
    const prose: string[] = [];
    let proseLine = -1;
    for (const i of b.lines) {
      const line = all[i]!;
      if (i !== b.anchor && isProse(line.text)) {
        prose.push(line.text.replace(BULLET, '').trim());
        if (proseLine < 0) proseLine = i;
        continue;
      }
      if (prose.length > 0) {
        prose.push(line.text.trim());
        continue;
      }
      for (const text of piecesOf(line, i === b.anchor ? b.range : null)) pieces.push({ text, line: i });
    }
    const company = pieces.find((p) => COMPANY_WORDS.test(toSimplified(p.text)) && !TITLE_WORDS.test(toSimplified(p.text))) ?? null;
    const title = pieces.find((p) => p !== company && TITLE_WORDS.test(toSimplified(p.text))) ?? null;
    const left = pieces.filter((p) => p !== company && p !== title);
    const companyFound = company ?? left.shift() ?? null;
    const titleFound = title ?? left.shift() ?? null;
    if (companyFound) out.push(check(`${prefix}.company`, companyFound.text, companyFound.line));
    if (titleFound) out.push(check(`${prefix}.position`, titleFound.text, titleFound.line));
    if (prose.length > 0) out.push(check(`${prefix}.description`, prose.join('\n'), proseLine));
    return out;
  });
}

export function readProjects(section: number[], all: TextLine[]): DraftField[] {
  return blocksOf(section, all).flatMap((b, n) => {
    const prefix = `projects.${n}`;
    const out = datesOf(prefix, b);
    const pieces = piecesOf(all[b.anchor]!, b.range);
    if (pieces[0]) out.push(check(`${prefix}.name`, pieces[0], b.anchor));
    if (pieces[1]) out.push(check(`${prefix}.role`, pieces[1], b.anchor));
    const rest = b.lines.filter((i) => i !== b.anchor).map((i) => all[i]!.text.replace(BULLET, '').trim());
    const first = b.lines.find((i) => i !== b.anchor);
    if (rest.length > 0 && first !== undefined) out.push(check(`${prefix}.description`, rest.join('\n'), first));
    return out;
  });
}

/** Names in a list, one a line or several with separators between. */
export function readSkills(section: number[], all: TextLine[]): DraftField[] {
  const out: DraftField[] = [];
  const seen = new Set<string>();
  for (const i of section) {
    for (const raw of all[i]!.text.replace(BULLET, '').split(/\s*[,，、;；|｜/]\s*/)) {
      const name = raw.trim();
      if (!name || name.length > 40 || seen.has(name.toLowerCase())) continue;
      seen.add(name.toLowerCase());
      if (out.length >= MAX_SKILLS) return out;
      out.push(check(`skills.${out.length}.name`, name, i));
    }
  }
  return out;
}
