// Lines of a resume to a draft for the applicant to check. Pure: no DOM, no storage, no network.
import { matchSection } from '../../dictionary/sections';
import type { SectionKey } from '../../schema/fieldKeys';
import type { TextLine } from '../extract/types';
import { cleanLines, withoutLongNumbers } from './clean';
import { phoneUnderLabel, readFormats, readLabels } from './contact';
import { readEducation, readJobs, readProjects, readSkills } from './entries';
import type { Draft, DraftField } from './types';

export type { Certainty, Draft, DraftField } from './types';

const MAX_HEADING_CHARS = 30;
const MIN_HEADING_CONFIDENCE = 0.9;
const NOT_A_NAME = /(?:简历|履历|resume|curriculum vitae|\bcv\b)/i;

/** A heading stands alone, says what follows, and holds no value. */
function headingOf(line: TextLine): SectionKey | 'other_people' | 'summary' | null {
  const t = line.text.trim().replace(/[：:]$/, '');
  if (line.cells.length > 1 || t.length > MAX_HEADING_CHARS) return null;
  if (/^(?:推荐人|证明人|紧急联系人|家庭成员|家庭情况|(?:professional |character |work )?(?:referees?|references?)(?: details| contacts?| information)?|emergency contacts?(?: details| information)?|next of kin)(?:\s*\d+)?$/i.test(t)) return 'other_people';
  if (/\d|@/.test(t)) return null;
  if (/^(?:个人简介|自我评价|自我介绍|个人总结|summary|profile|about me|professional summary|career summary)$/i.test(t)) return 'summary';
  // Resumes are shorter about this than application forms.
  if (/^(?:experience|relevant experience|工作|经历)$/i.test(t)) return 'work';
  const m = matchSection(t);
  return m && m.confidence >= MIN_HEADING_CONFIDENCE ? m.section : null;
}

const ZH_TWO_CHAR_FAMILY = /^(?:钟离|万俟|闻人|赫连|公羊|澹台|公冶|宗政|濮阳|淳于|单于|太叔|申屠|仲孙|轩辕|鲜于|闾丘|司空|亓官|司寇|子车|颛孙|端木|巫马|公西|漆雕|乐正|壤驷|公良|拓跋|夹谷|宰父|谷梁|段干|百里|东郭|南门|呼延|羊舌|微生|梁丘|左丘|东门|西门|南宫|第五|欧阳|司马|上官|诸葛|令狐|皇甫|尉迟|公孙|慕容|东方|夏侯|司徒|长孙|宇文|轩辕|端木|南宫|独孤|百里|呼延)/;

/** Which part of a name is which is always a reading of it, however clearly the name itself was labelled. */
function splitName(name: string, line: number): DraftField[] {
  const f = (path: string, value: string): DraftField => ({ path, value, certainty: 'check', line });
  const han = name.replace(/\s/g, '');
  if (/^\p{Script=Han}{2,5}$/u.test(han)) {
    const family = ZH_TWO_CHAR_FAMILY.exec(han)?.[0] ?? han[0]!;
    return [f('basics.familyName', family), f('basics.givenName', han.slice(family.length))];
  }
  const preferred = /[(（]([^)）]+)[)）]/.exec(name)?.[1]?.trim();
  const plain = name.replace(/[(（][^)）]*[)）]/g, ' ').replace(/\s+/g, ' ').trim();
  // "Smith, John": the comma says the family name came first.
  const comma = /^([^,，]+)[,，]\s*(.+)$/.exec(plain);
  if (comma) return [f('basics.familyName', comma[1]!.trim()), f('basics.givenName', comma[2]!.trim())];
  const words = plain.split(' ');
  if (words.length < 2) return [f('basics.givenName', plain)];
  // "WANG Xiaoming": capitals say which one is the family name, wherever it stands.
  const capitals = words.filter((w) => w.length > 1 && w === w.toUpperCase() && w !== w.toLowerCase());
  if (capitals.length === 1) return [f('basics.familyName', capitals[0]!), f('basics.givenName', words.filter((w) => w !== capitals[0]).join(' '))];
  const out = [f('basics.givenName', words.slice(0, -1).join(' ')), f('basics.familyName', words[words.length - 1]!)];
  if (preferred) out.push(f('basics.preferredName', preferred));
  return out;
}

/** An unlabelled name: the largest text up top, or the first short line, if it reads like one. */
function findName(lines: TextLine[], firstHeading: number): { text: string; line: number } | null {
  const head = lines.slice(0, firstHeading < 0 ? lines.length : firstHeading).map((l, i) => ({ l, i }));
  const looks = ({ l }: { l: TextLine }): boolean => {
    const t = l.text.trim();
    if (l.cells.length > 1 || /[\d@:：/|]/.test(t) || NOT_A_NAME.test(t)) return false;
    if (/^\p{Script=Han}{2,5}$/u.test(t)) return true;
    const words = t.replace(/[(（][^)）]*[)）]/g, ' ').trim().split(/\s+/);
    return words.length >= 2 && words.length <= 4 && words.every((w) => /^\p{Lu}[\p{L}'’.-]*$/u.test(w));
  };
  const candidates = head.filter(looks);
  if (candidates.length === 0) return null;
  const best = candidates.reduce((a, b) => (b.l.fontSize > a.l.fontSize ? b : a), candidates[0]!);
  return { text: best.l.text.trim(), line: best.i };
}

const AU_STATE = /\b(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)\b/;

/** A place by itself on a contact line: "Brisbane QLD". */
function findPlace(lines: TextLine[], head: number[]): DraftField[] {
  for (const i of head) {
    for (const part of lines[i]!.text.split(/\s*[|｜•·,]\s*/)) {
      const m = /^(\p{Lu}[\p{L} ]{1,24}?)\s+(NSW|VIC|QLD|SA|WA|TAS|ACT|NT)$/u.exec(part.trim());
      if (m && AU_STATE.test(part)) {
        return [
          { path: 'contact.address.city', value: m[1]!, certainty: 'check', line: i },
          { path: 'contact.address.province', value: m[2]!, certainty: 'check', line: i },
          { path: 'contact.address.country', value: 'Australia', certainty: 'check', line: i },
        ];
      }
    }
  }
  return [];
}

const GENDER_WORDS: Record<string, string> = { 男: 'male', 女: 'female', male: 'male', female: 'female' };
const POLITICAL_WORDS: Record<string, string> = { 群众: 'masses', 中共党员: 'party_member', 党员: 'party_member', 共青团员: 'league_member', 团员: 'league_member', 预备党员: 'probationary_party_member' };
const MARITAL_WORDS: Record<string, string> = { 未婚: 'single', 已婚: 'married', 离异: 'divorced', single: 'single', married: 'married', divorced: 'divorced' };

/** Words a label's value is written in, to the codes a resume keeps. What cannot be turned into a code is dropped. */
function settle(fields: DraftField[]): DraftField[] {
  return fields.flatMap((f): DraftField[] => {
    const key = f.value.trim().toLowerCase();
    if (f.path === 'name') return splitName(f.value, f.line);
    if (f.path === 'location') return [{ ...f, path: 'contact.address.city', certainty: 'check' }];
    if (f.path === 'contact.phone') {
      const phone = phoneUnderLabel(f.value);
      if (!phone) return [];
      if (!phone.code) return [{ ...f, value: phone.number }];
      const inferred = 'inferred' in phone && phone.inferred;
      return [{ ...f, value: phone.number }, { ...f, path: 'contact.phoneCountryCode', value: phone.code, certainty: inferred ? 'check' : f.certainty }];
    }
    if (f.path === 'nativePlace') return [{ ...f, path: 'basics.nativePlace.city' }];
    if (f.path === 'basics.gender') return GENDER_WORDS[key] ? [{ ...f, value: GENDER_WORDS[key]! }] : [];
    if (f.path === 'basics.politicalStatus') return POLITICAL_WORDS[key] ? [{ ...f, value: POLITICAL_WORDS[key]! }] : [];
    if (f.path === 'basics.maritalStatus') return MARITAL_WORDS[key] ? [{ ...f, value: MARITAL_WORDS[key]! }] : [];
    if (f.path === 'basics.birthDate') {
      const m = /((?:19|20)\d{2})\s*[./年-]\s*(\d{1,2})(?:\s*[./月-]\s*(\d{1,2}))?/.exec(f.value);
      if (!m) return [];
      const value = `${m[1]}-${m[2]!.padStart(2, '0')}${m[3] ? `-${m[3].padStart(2, '0')}` : ''}`;
      return [{ ...f, value }];
    }
    return [f];
  });
}

/** More than any resume has. A file with more than this has been made to look like one. */
export const MAX_DRAFT_FIELDS = 500;

const OTHER_PERSON_LINE = /紧急联系人|推荐人|证明人|referee|emergency contact|next of kin/i;
const isSentence = (text: string): boolean => /[.。!！?？]\s*$/.test(text) || text.length > 120;

/** What the applicant wrote freely has no business holding a long number, whoever's it is. */
const FREE_TEXT = /^(?:selfIntroduction$|skills\.|(?:work|projects|education)\.\d+\.(?:description|major|school|company|position|name|role)$|contact\.address\.street$|basics\.nationality$)/;

function withoutStrayNumbers(f: DraftField): DraftField[] {
  if (!FREE_TEXT.test(f.path)) return [f];
  const value = f.value.split('\n').map(withoutLongNumbers).filter(Boolean).join('\n');
  return value ? [{ ...f, value }] : [];
}

/** One box per field on the check page: what is certain if something is, or else the first one found. */
function oncePerPath(fields: DraftField[]): DraftField[] {
  const out = new Map<string, DraftField>();
  for (const f of fields) {
    const seen = out.get(f.path);
    if (!seen || (seen.certainty === 'check' && f.certainty === 'high')) out.set(f.path, f);
  }
  return [...out.values()];
}

export function parseResume(raw: TextLine[]): Draft {
  const lines = cleanLines(raw);
  const whole = lines.map((l) => l.text).join('');
  const han = (whole.match(/\p{Script=Han}/gu) ?? []).length;
  const letters = (whole.match(/[A-Za-z]/g) ?? []).length;
  const locale: Draft['locale'] = han > 0 && han * 4 >= letters ? 'zh-CN' : 'en-AU';

  // Cut the file by its headings.
  const sections = new Map<string, number[]>();
  const headings = lines.map(headingOf);
  const firstHeading = headings.findIndex(Boolean);
  let current: string = 'head';
  lines.forEach((_, i) => {
    const h = headings[i];
    // "Contact" inside the referees is how to reach them. A part of the applicant's own takes over from there.
    if (h && !(current === 'other_people' && (h === 'contact' || h === 'basics'))) {
      current = h;
      if (!sections.has(current)) sections.set(current, []);
      return;
    }
    if (!sections.has(current)) sections.set(current, []);
    sections.get(current)!.push(i);
  });
  const section = (key: string): number[] => sections.get(key) ?? [];
  const otherPeople = new Set(section('other_people'));
  // A line that says whose details it holds, wherever it stands.
  lines.forEach((l, i) => {
    if (OTHER_PERSON_LINE.test(l.text)) otherPeople.add(i);
  });

  // A file with no headings at all has only a top, and no reason to call all of it the applicant's own. A sentence is
  // someone talking, as in a note above the resume, and no contact line.
  const ownLines = new Set(
    [...(firstHeading >= 0 ? section('head') : section('head').slice(0, 8)), ...section('contact'), ...section('basics')].filter((n) => !isSentence(lines[n]!.text)),
  );
  const labelled = readLabels(lines, otherPeople, ownLines);
  const labelledPhone = labelled.some((f) => f.path === 'contact.phone' && phoneUnderLabel(f.value));
  const formats = readFormats(lines, otherPeople, ownLines).filter((f) => !labelledPhone || !['contact.phone', 'contact.phoneCountryCode'].includes(f.path));
  const has = (path: string): boolean => labelled.some((f) => f.path === path);
  const fields: DraftField[] = [
    ...formats,
    // A label that only repeats what the format has already proved says nothing new.
    ...labelled.filter((f) => f.path !== 'contact.email' || !formats.some((x) => x.path === f.path && x.certainty === 'high')),
  ];

  if (!has('name')) {
    const name = findName(lines, firstHeading);
    if (name) fields.push({ path: 'name', value: name.text, certainty: 'check', line: name.line });
  }
  if (!has('location')) fields.push(...findPlace(lines, [...section('head'), ...section('contact')]));

  const summary = section('summary');
  if (summary.length > 0) {
    fields.push({ path: 'selfIntroduction', value: summary.map((i) => lines[i]!.text.trim()).join('\n'), certainty: 'check', line: summary[0]! });
  }
  fields.push(...readEducation(section('education'), lines));
  const jobs = readJobs(section('work'), lines, 0, 'full_time');
  const jobCount = new Set(jobs.map((f) => f.path.split('.')[1])).size;
  fields.push(...jobs, ...readJobs(section('internship'), lines, jobCount, 'internship'));
  fields.push(...readProjects(section('projects'), lines));
  fields.push(...readSkills(section('skills'), lines));

  return { locale, fields: oncePerPath(settle(fields).flatMap(withoutStrayNumbers)).slice(0, MAX_DRAFT_FIELDS) };
}
