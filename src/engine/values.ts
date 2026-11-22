// Values: resume data for a field key (resolveValue) and its translation into a driver intent (toIntent).
import { formatByPattern, isDatePattern } from './dateFormat';
import { OPTION_SYNONYMS, hasCjk, isInOtherCountry, isPlaceholderOption, matchOption, namesOtherState, namesPlace, placeOptions, placeSpellings } from '../dictionary';
import { asksBesidesEnglish, asksPartScore, bestEnglish, isEnglishTest, languageNamed, languageOf, testOf, testsNamed } from './languageAsked';
import type { FileData, FillIntent, OptionMatch, OptionMatcher } from '../drivers/types';
import type { GenderAnswer, LanguageEntry, Locale, Region, Resume } from '../schema';
import { LANGUAGE_TEST_LABELS, isLanguageTestCode } from '../schema/languageTests';
import { getFieldKeyDef, type FieldKeyDef } from '../schema/fieldKeys';
import { isSensitiveFieldKey, type SensitiveFieldMode } from '../schema/sensitive';
import { formatWithPreset, type InterpolationContext, type MappingPresetId } from '../templates/presets';
import type { Control, FieldKey, OptionInfo, SectionKey } from './types';


/** What resolveValue hands to toIntent: scalars, string lists, regions, or a file id (attachments). */
export type RawValue = string | number | boolean | string[] | Region;

export interface ResolvedValue {
  raw: RawValue;
  /** Resume path, e.g. "education[1].school" (index into the stored array). */
  source: string;
}

export interface ResolveOptions {
  /** The page has an internship section, so the work section takes only non-internship entries. */
  hasInternshipSection?: boolean;
  /** Clock for derived values (basics.age). */
  now?: Date;
  /** The question as the page words it: one about English, or about one test, picks its language entry. */
  askedAs?: string;
  /** Advice under the section's title, which can narrow it: 除英语外的其他外语能力. */
  sectionNote?: string;
  /** The applicant's choice for sensitive fields: only 'fill' gives their values. */
  sensitiveFields?: SensitiveFieldMode;
}

/** Enum domains for text-typed keys that nevertheless have a dictionary (used when the control offers options). */
const DOMAIN_OVERRIDES: Record<FieldKey, string> = {
  'languages.certificate': 'languageCert',
  'basics.pronouns': 'pronouns',
};

export function domainFor(def: FieldKeyDef): string | null {
  return def.enumDomain ?? DOMAIN_OVERRIDES[def.key] ?? null;
}

// ---- helpers --------------------------------------------------------------------------------------------

const ADDRESS_FIELDS: Record<string, keyof Resume['contact']['address']> = {
  addressCountry: 'country',
  addressProvince: 'province',
  addressCity: 'city',
  addressDistrict: 'district',
  addressStreet: 'street',
  postcode: 'postcode',
};

const ATTACHMENT_FIELDS: Record<string, keyof Resume['attachments']> = {
  resume: 'resumeFileId',
  photo: 'photoFileId',
  transcript: 'transcriptFileId',
  portfolio: 'portfolioFileId',
};

type ArrayModule =
  | 'education' | 'work' | 'projects' | 'campus' | 'awards' | 'languages' | 'certificates' | 'skills' | 'family'
  | 'referees';
const ARRAY_MODULES: ReadonlySet<string> = new Set<ArrayModule>([
  'education', 'work', 'projects', 'campus', 'awards', 'languages', 'certificates', 'skills', 'family', 'referees',
]);

function clean(v: unknown): RawValue | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'string') return v.trim() === '' ? null : v.trim();
  if (typeof v === 'number' || typeof v === 'boolean') return v;
  if (Array.isArray(v)) {
    const items = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim());
    return items.length > 0 ? items : null;
  }
  if (typeof v === 'object') {
    const region = v as Region;
    return [region.country, region.province, region.city, region.district].some((x) => x && x.trim()) ? region : null;
  }
  return null;
}

const isCjkResume = (resume: Resume) => resume.locale === 'zh-CN';

export interface EntryRef<T> {
  entry: T;
  /** Index in the stored array. */
  index: number;
}

/**
 * Resume entries that feed a page section (plan 0.7): internship section → work entries of kind
 * 'internship'; work section → the others (all of them when the page has no internship section).
 */
const MOTHER_TONGUE = /^(?:中文|汉语|漢語|普通话|普通話|国语|國語|中文普通话|中文\s*[(（]普通话[)）]|Chinese|Mandarin|Mandarin Chinese|Chinese\s*\(Mandarin\))$/i;

export function sectionEntries(
  resume: Resume,
  module: ArrayModule,
  section: SectionKey | null,
  hasInternshipSection = false,
): EntryRef<unknown>[] {
  const all = (resume[module] as unknown[]).map((entry, index) => ({ entry, index }));
  // No Chinese form asks about Chinese on its list of languages, and a card opened for it would stay empty.
  if (module === 'languages' && resume.locale === 'zh-CN') return all.filter((r) => !MOTHER_TONGUE.test((r.entry as { language?: string }).language?.trim() ?? ''));
  if (module !== 'work') return all;
  const kindOf = (e: unknown) => (e as Resume['work'][number]).kind;
  if (section === 'internship') return all.filter((r) => kindOf(r.entry) === 'internship');
  if (section === 'work' && hasInternshipSection) return all.filter((r) => kindOf(r.entry) !== 'internship');
  return all;
}

/** Number of resume entries a repeated section would need cards for (0 for non-array sections). */
export function entryCount(resume: Resume, section: SectionKey, hasInternshipSection = false): number {
  const module = section === 'internship' ? 'work' : section;
  if (!ARRAY_MODULES.has(module)) return 0;
  return sectionEntries(resume, module as ArrayModule, section, hasInternshipSection).length;
}

/** A field of an array entry as a page would show it: an enum by its label. Empty when it holds no text. */
export function entryFieldText(module: string, field: string, entry: unknown, locale: Locale): string {
  const raw = (entry as Record<string, unknown>)[field];
  if (typeof raw !== 'string' || raw.trim() === '') return '';
  const def = getFieldKeyDef(`${module}.${field}` as FieldKey);
  return def?.type === 'enum' ? optionLabel(domainFor(def), raw, locale) : raw;
}

const SCHOOLING_RANK: Record<string, number> = { high_school: 1, associate: 2, bachelor: 3, master: 4, phd: 5 };

const STILL_RUNNING = '9999';
const endOfSchooling = (r: { entry: unknown }): string => {
  const e = r.entry as { endDate?: string | null; current?: boolean };
  return e.endDate || (e.current ? STILL_RUNNING : '');
};

function highestSchooling<T extends { entry: unknown }>(rows: T[]): T | undefined {
  const rank = (r: T) => SCHOOLING_RANK[(r.entry as { degree?: string }).degree ?? ''] ?? 0;
  const best = rows.reduce<T | undefined>(
    (top, r) => (!top || rank(r) > rank(top) || (rank(r) === rank(top) && endOfSchooling(r) > endOfSchooling(top)) ? r : top),
    undefined,
  );
  // A later row with no level written down may be the higher one, and nothing here can say.
  return best && rows.some((r) => rank(r) === 0 && endOfSchooling(r) > endOfSchooling(best)) ? undefined : best;
}

// ---- Language entries -----------------------------------------------------------------------------------

/**
 * The language entry a question means. One that names tests takes the best of those sat (bestEnglish); one about
 * English takes the best English entry, so a level and its score come from the same entry; one that names another
 * language takes that language, by any of its names. When the resume has none of these, nothing: the field stays
 * empty rather than taking another language's answer. A question about the languages besides English takes those in
 * order, and any other question takes the cards in order.
 */
function languageRow<T extends { entry: unknown }>(rows: T[], entryIndex: number, askedAs = '', sectionNote = ''): T | undefined {
  if (asksBesidesEnglish(askedAs) || asksBesidesEnglish(sectionNote)) return rows.filter((r) => languageOf(r.entry) !== 'en')[entryIndex];
  const tests = testsNamed(askedAs);
  if (tests.length > 0) return bestEnglish(rows.filter((r) => tests.includes(testOf(r.entry) ?? '')));
  const language = languageNamed(askedAs);
  if (language === 'en') return bestEnglish(rows.filter((r) => languageOf(r.entry) === 'en'));
  if (language) return rows.find((r) => languageOf(r.entry) === language);
  return rows[entryIndex];
}

/** A language row; one standing for a test in an entry's list has the path of that test. */
type LanguageRow = EntryRef<unknown> & { path?: string };

/**
 * The rows a question about a test or a language reads: each test in an entry's list stands as a row of its own (the
 * test as its certificate, with its score), so the list is read first. The entry itself stays a row only when its
 * certificate names a test the list does not have, or names none (then it steps aside for the tests in bestEnglish).
 */
function withTestRows(rows: EntryRef<unknown>[]): LanguageRow[] {
  return rows.flatMap((r): LanguageRow[] => {
    const entry = r.entry as Partial<LanguageEntry>;
    const listed = (entry.tests ?? []).flatMap((t, j): LanguageRow[] =>
      isLanguageTestCode(t.test)
        ? [{
            entry: { language: entry.language ?? '', proficiency: entry.proficiency ?? null, certificate: LANGUAGE_TEST_LABELS[t.test], score: t.score },
            index: r.index,
            path: `languages[${r.index}].tests[${j}]`,
          }]
        : [],
    );
    if (listed.length === 0) return [r];
    const own = testOf(entry);
    return own !== undefined && listed.some((l) => testOf(l.entry) === own) ? listed : [...listed, r];
  });
}

/** A certificate or score question that names a test or a language: the one a test list answers. */
const asksAboutTests = (field: string, opts: ResolveOptions): boolean =>
  (field === 'certificate' || field === 'score') &&
  !asksBesidesEnglish(opts.askedAs ?? '') &&
  !asksBesidesEnglish(opts.sectionNote ?? '') &&
  (testsNamed(opts.askedAs ?? '').length > 0 || languageNamed(opts.askedAs ?? '') !== undefined);

/**
 * For an English level on a list that takes several answers: every English test the resume holds, from the test lists
 * and from older entries' certificates, each once, in resume order. A question naming tests takes only those. Null when
 * the question is not about English, or no English test is held.
 */
export function everyEnglishTest(resume: Resume, askedAs: string, sectionNote = ''): { intent: FillIntent; source: string } | null {
  if (asksBesidesEnglish(askedAs) || asksBesidesEnglish(sectionNote)) return null;
  const named = testsNamed(askedAs);
  if (named.length > 0 ? !named.every((t) => isEnglishTest(t)) : languageNamed(askedAs) !== 'en') return null;
  const held = new Map<string, { label: string; source: string }>();
  for (const row of withTestRows(sectionEntries(resume, 'languages', 'languages'))) {
    const test = testOf(row.entry);
    if (!test || !isEnglishTest(test) || held.has(test) || (named.length > 0 && !named.includes(test))) continue;
    const label = (row.entry as { certificate: string }).certificate.trim();
    held.set(test, { label, source: row.path ? `${row.path}.test` : `languages[${row.index}].certificate` });
  }
  if (held.size === 0) return null;
  const tests = [...held.values()];
  return {
    intent: {
      kind: 'multi',
      display: tests.map((t) => t.label).join('、'),
      items: tests.map((t) => ({ query: t.label, match: (options) => matchOption('languageCert', t.label, options) })),
    },
    source: tests.map((t) => t.source).join('+'),
  };
}

const SUPERVISED = /导师|指导(?:老师|教师)|supervisor|advis[oe]r/i;
const schoolName = (s: unknown): string => (typeof s === 'string' ? s.normalize('NFKC').replace(/\s+/g, '').toLowerCase() : '');

/**
 * 在校导师 on a school's card: a referee whose relationship says supervisor and who works at that school. Anyone
 * else, or one at another school, is not this card's answer.
 */
function supervisorAt(school: Record<string, unknown>, resume: Resume): ResolvedValue | null {
  const names = [school.school, school.schoolEn].map(schoolName).filter(Boolean);
  if (names.length === 0) return null;
  const hits = resume.referees.flatMap((r, index) =>
    SUPERVISED.test(r.relationship ?? '') && names.includes(schoolName(r.company)) && r.name.trim() ? [{ name: r.name.trim(), index }] : [],
  );
  return hits.length === 1 ? { raw: hits[0]!.name, source: `referees[${hits[0]!.index}].name` } : null;
}

const lastSchooling = <T extends { entry: unknown }>(rows: T[]): T | undefined =>
  rows.reduce<T | undefined>((last, r) => (!last || endOfSchooling(r) > endOfSchooling(last) ? r : last), undefined);

const NEW_ZEALAND = /new\s*zealand|\bnz\b|kiwi|新西兰|新西蘭|纽西兰|紐西蘭/i;

function ageOf(birthDate: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(birthDate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 1)];
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age -= 1;
  return age >= 0 ? age : null;
}

const STILL_GOING = 'now';

/** A span as "start/end". The end is the word for a current entry, and empty when the file does not say. */
function periodOf(entry: Record<string, unknown>, source: string): ResolvedValue | null {
  const start = clean(entry.startDate);
  if (typeof start !== 'string') return null;
  const end = clean(entry.endDate);
  return { raw: `${start}/${typeof end === 'string' ? end : entry.current === true ? STILL_GOING : ''}`, source };
}

function periodText(start: string, end: string, locale: Locale): string | null {
  if (!end) return null;
  if (locale === 'zh-CN') return `${start.replaceAll('-', '.')}-${end === STILL_GOING ? '至今' : end.replaceAll('-', '.')}`;
  return `${start} - ${end === STILL_GOING ? 'Present' : end}`;
}

function derived(fieldKey: FieldKey, resume: Resume, opts: ResolveOptions): ResolvedValue | null {
  const { basics, contact } = resume;
  switch (fieldKey) {
    case 'basics.fullName': {
      const family = basics.familyName.trim();
      const given = basics.givenName.trim();
      const raw = isCjkResume(resume) ? `${family}${given}` : [given, family].filter(Boolean).join(' ');
      return raw ? { raw, source: 'basics.familyName+givenName' } : null;
    }
    case 'basics.currentLocation': {
      // Asked as "where are you based": the home address answers it, but only down to the city.
      if (clean(basics.currentLocation) !== null) return null;
      const { country, province, city } = contact.address;
      return province.trim() || city.trim() ? { raw: { country, province, city }, source: 'contact.address' } : null;
    }
    case 'education.fullTimeStudent': {
      // The latest schooling: still going (no end yet, or an end this month or later) and full-time.
      const latest = [...resume.education].sort((a, b) => (b.startDate ?? '').localeCompare(a.startDate ?? ''))[0];
      if (!latest) return null;
      const now = opts.now ?? new Date();
      const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
      const end = (latest.endDate ?? '').slice(0, 7);
      if (!latest.current && end !== '' && end < thisMonth) return { raw: false, source: 'education.endDate' };
      if (!latest.current && end === '') return null;
      if (latest.educationType === 'part_time') return { raw: false, source: 'education.educationType' };
      return latest.educationType === 'full_time' ? { raw: true, source: 'education.educationType' } : null;
    }
    case 'basics.isAdult': {
      // A month-only birth date in the eighteenth birthday's month could go either way: say nothing.
      const birth = basics.birthDate.trim();
      const now = opts.now ?? new Date();
      const oldest = ageOf(birth, now);
      const youngest = /^\d{4}-\d{2}$/.test(birth) ? ageOf(`${birth}-31`, now) : oldest;
      if (oldest === null || youngest === null || oldest >= 18 !== youngest >= 18) return null;
      return { raw: oldest >= 18, source: 'basics.birthDate' };
    }
    case 'workRights.citizenOrResident': {
      const status = resume.workRights.status;
      if (status === 'citizen' || status === 'permanent_resident') return { raw: true, source: 'workRights.status' };
      if (status === 'graduate_visa' || status === 'student_visa' || status === 'working_holiday' || status === 'no_rights') {
        return { raw: false, source: 'workRights.status' };
      }
      // Another temporary visa: a New Zealander's, whom the question often counts in, unless the nationality says not.
      const nationality = basics.nationality.trim();
      if (status === 'other_temporary' && nationality && !NEW_ZEALAND.test(nationality)) return { raw: false, source: 'workRights.status' };
      return null;
    }
    case 'basics.age': {
      const age = ageOf(basics.birthDate, opts.now ?? new Date());
      return age === null ? null : { raw: age, source: 'basics.birthDate' };
    }
    case 'contact.phoneFull': {
      const phone = contact.phone.trim();
      if (!phone) return null;
      const cc = contact.phoneCountryCode.trim();
      // National numbers drop their trunk 0 behind a country code (+61 0412… → +61 412…).
      return { raw: withDialCode(cc, phone), source: 'contact.phoneCountryCode+phone' };
    }
    case 'contact.addressFull': {
      const a = contact.address;
      const parts = isCjkResume(resume)
        ? [a.province, a.city, a.district, a.street]
        : [a.street, a.city, [a.province, a.postcode].filter(Boolean).join(' '), a.country];
      const raw = parts.filter((p) => p && p.trim()).join(isCjkResume(resume) ? '' : ', ');
      return raw ? { raw, source: 'contact.address' } : null;
    }
    default:
      return null;
  }
}


/**
 * Value of a field key for card `entryIndex` of a page section. Handles derived keys, the work/internship
 * split, and treats empty strings / null as missing. A current entry has no end date.
 */
export function resolveValue(
  fieldKey: FieldKey,
  resume: Resume,
  entryIndex: number,
  section: SectionKey | null,
  opts: ResolveOptions = {},
): ResolvedValue | null {
  const dot = fieldKey.indexOf('.');
  if (dot < 0) return null;
  // An identity number is given only when the applicant chose to fill such fields, wherever it is asked for.
  if (isSensitiveFieldKey(fieldKey) && opts.sensitiveFields !== 'fill') return null;
  const module = fieldKey.slice(0, dot);
  const field = fieldKey.slice(dot + 1);

  const viaDerived = derived(fieldKey, resume, opts);
  if (viaDerived) return viaDerived;

  const wrap = (raw: unknown, source: string): ResolvedValue | null => {
    const value = clean(raw);
    return value === null ? null : { raw: value, source };
  };

  if (module === 'misc') {
    const raw = (resume as unknown as Record<string, unknown>)[field];
    return wrap(raw, field);
  }
  if (module === 'attachments') {
    const prop = ATTACHMENT_FIELDS[field];
    return prop ? wrap(resume.attachments[prop], `attachments.${prop}`) : null;
  }
  if (module === 'contact' && field in ADDRESS_FIELDS) {
    const prop = ADDRESS_FIELDS[field]!;
    return wrap(resume.contact.address[prop], `contact.address.${prop}`);
  }
  // The resume holds one score per test; a box for one skill's part of it (听力成绩) has no answer there.
  if (fieldKey === 'languages.score' && asksPartScore(opts.askedAs ?? '')) return null;
  // A supervisor at school belongs to one school's card. Away from it, a mentor is someone else's.
  if (fieldKey === 'education.supervisor' && section !== 'education') return null;
  if (ARRAY_MODULES.has(module)) {
    const rows = sectionEntries(resume, module as ArrayModule, section, opts.hasInternshipSection);
    // Away from the cards, as on 最高学历 next to the name, a question about schooling means the highest.
    const row =
      module === 'education' && section && section !== 'education' && entryIndex === 0
        ? highestSchooling(rows)
        : module === 'languages'
          ? languageRow<LanguageRow>(asksAboutTests(field, opts) ? withTestRows(rows) : rows, entryIndex, opts.askedAs, opts.sectionNote)
          : rows[entryIndex];
    if (!row) return null;
    const entry = row.entry as Record<string, unknown>;
    const path = (row as LanguageRow).path;
    // A test from an entry's list is found at its own place there: its name is `test`.
    const source = path ? `${path}.${field === 'certificate' ? 'test' : field}` : `${module}[${row.index}].${field}`;
    if (field === 'classYear') {
      // Which class someone belongs to, wherever it is asked: the schooling they are finishing, not this card's.
      const latest = lastSchooling(rows) ?? row;
      const year = /^(\d{4})/.exec(String((latest.entry as { endDate?: string | null }).endDate ?? ''))?.[1];
      return year ? { raw: year, source: `${module}[${latest.index}].endDate` } : null;
    }
    if (field === 'endDate' && entry.current === true && !entry.endDate) return null;
    if (field === 'period') return periodOf(entry, source);
    if (field === 'supervisor') return supervisorAt(entry, resume);
    return wrap(entry[field], source);
  }
  const single = (resume as unknown as Record<string, Record<string, unknown> | undefined>)[module];
  if (!single || typeof single !== 'object') return null;
  return wrap(single[field], `${module}.${field}`);
}

// ---- labels ---------------------------------------------------------------------------------------------

/**
 * Display label of an enum code in the resume's language: the first dictionary synonym written in that
 * language ("father" → 父亲 / Father). Unknown codes come back unchanged.
 */
export function optionLabel(domain: string | null, code: string, locale: Locale): string {
  const syns = domain ? OPTION_SYNONYMS[domain]?.[code] : undefined;
  if (!syns || syns.length === 0) return code;
  const wantCjk = locale === 'zh-CN';
  return syns.find((s) => hasCjk(s) === wantCjk) ?? syns[0]!;
}

// ---- intents --------------------------------------------------------------------------------------------

function withDialCode(rawCode: string, phone: string): string {
  // Already written in full: the number knows its country better than the code beside it.
  if (phone.startsWith('+')) return phone;
  const cc = rawCode && !rawCode.startsWith('+') ? `+${rawCode}` : rawCode;
  const national = cc && cc !== '+86' ? phone.replace(/^0/, '') : phone;
  return cc ? `${cc} ${national}` : national;
}

/** The code a phone widget has selected by itself, by its country picker. Null when it shows none. */
function dialCodeShown(el: Element): string | null {
  const widget = el.closest('.iti');
  if (!widget) return null;
  const separate = widget.querySelector('.iti__selected-dial-code')?.textContent ?? '';
  const picker = widget.querySelector('.iti__selected-country, .iti__selected-flag');
  const said = `${separate} ${picker?.getAttribute('title') ?? ''} ${picker?.getAttribute('aria-label') ?? ''}`;
  return /\+\s*(\d{1,4})/.exec(said)?.[1] ?? null;
}

export interface IntentOptions {
  /** The words on the field, where the same fact has two names. */
  askedAs?: string;
  /** The applicant's own dial code, for a phone widget that has picked another country. */
  dialCode?: string;
  /** Attachment files by id (the run payload's `files`). */
  files?: Record<string, FileData>;
  /** The home address, to tell which of several places of one name is meant. */
  home?: Region;
  /** How to answer a gender question that offers a way to decline. Without it: from the resume. */
  genderAnswer?: GenderAnswer;
  /** Optional autofill text formatting / interpolation preset. */
  presetId?: MappingPresetId;
  /** Context used to expand {{company}}, {{role}}, etc. placeholders. */
  presetCtx?: InterpolationContext;
}

const isTextLike = (c: Control) => c.kind === 'text' || c.kind === 'textarea' || c.kind === 'richtext';
const hasPickList = (c: Control) =>
  c.kind === 'select' || c.kind === 'radio' || (c.kind === 'checkbox' && !!c.options);

function parseDate(raw: string): { year: number; month: number; day?: number } | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(raw);
  if (!m) return null;
  const out: { year: number; month: number; day?: number } = { year: Number(m[1]), month: Number(m[2]) };
  if (m[3]) out.day = Number(m[3]);
  return out;
}

const pad = (n: number) => String(n).padStart(2, '0');

function dateIntent(raw: string, control: Control): FillIntent | null {
  const d = parseDate(raw);
  if (!d) return null;
  const granularity = control.dateGranularity ?? (control.inputType === 'month' ? 'month' : 'day');
  if (granularity === 'day') {
    // Month-only data on a day picker (native input[type=date]): first of the month.
    const day = d.day ?? 1;
    return { kind: 'date', display: `${d.year}-${pad(d.month)}-${pad(day)}`, year: d.year, month: d.month, day };
  }
  const display = granularity === 'month' ? `${d.year}-${pad(d.month)}` : String(d.year);
  return { kind: 'date', display, year: d.year, month: d.month };
}

function choice(domain: string | null, value: string | boolean, label: string): FillIntent {
  return { kind: 'choice', display: label, query: label, match: (options) => matchOption(domain, value, options) };
}

function multiOrChoice(domain: string | null, values: string[], control: Control): FillIntent {
  if (control.multiple) {
    return {
      kind: 'multi',
      display: values.join('、'),
      items: values.map((v) => ({ query: v, match: (options) => matchOption(domain, v, options) })),
    };
  }
  // One answer only: the rest of the list, in the order written, for when the page does not offer the first.
  const [first, ...rest] = values;
  const one = choice(domain, first!, first!);
  if (rest.length === 0 || one.kind !== 'choice') return one;
  return { ...one, fallbacks: rest.map((v) => ({ query: v, match: (options: OptionInfo[]) => matchOption(domain, v, options) })) };
}

/** Region parts in the order a person writes them: zh 浙江省杭州市西湖区, en "Brisbane, QLD". */
function regionPath(region: Region): string[] {
  const parts = [region.province, region.city, region.district].map((p) => p?.trim() ?? '').filter(Boolean);
  if (parts.length === 0 && region.country?.trim()) return [region.country.trim()];
  return parts;
}

type PlaceLevel = 'province' | 'city' | 'district';

const PLACE_WORD = /(?:壮族|回族|维吾尔)?自治区$|特别行政区$|[省市区县]$/;
/** What a place of each level may be called when the resume leaves the word off. */
const WORD_OF_LEVEL: Record<PlaceLevel, RegExp> = {
  province: /(?:自治区|特别行政区|省)$|^(?:北京|上海|天津|重庆)市$/,
  city: /市$/,
  district: /[区县市]$/,
};

/**
 * 吉林省 and 吉林市 on a resume can both be written 吉林, and 武侯 can be 武侯区. But 吉林省 is not 吉林市, 朝阳区 is not
 * 朝阳市, and a bare 河北 on a list is the province, not 天津's 河北区.
 */
function isSamePlace(name: string, label: string, level: PlaceLevel): boolean {
  const n = name.trim().replace(/^中国/, '');
  const l = label.trim().replace(/^中国/, '');
  if (n === l) return n !== '';
  const bare = n.replace(PLACE_WORD, '');
  if (!bare || bare !== l.replace(PLACE_WORD, '')) return false;
  if (l === bare) return level !== 'district';
  return n === bare && WORD_OF_LEVEL[level].test(l);
}

/** The entry for a place the list does not name. */
const OTHER_PLACE =
  /^(?:other|others|other\s+(?:city|cities|location|area|region|place)|somewhere\s+else|其他|其它)(?:城市|地区|地區|地点|地點)?\s*(?:\(.*\)|（.*）)?$/i;

/** The one "Other" on a list of places. Two of them, or none, and there is nothing to pick. */
function otherPlace(options: OptionInfo[]): OptionMatch {
  const hits = options.flatMap((o, i) => (!o.disabled && !isPlaceholderOption(o) && OTHER_PLACE.test(o.label.trim()) ? [i] : []));
  return hits.length === 1 ? { status: 'matched', index: hits[0]!, confidence: 0.8 } : { status: 'none' };
}

/** On a list, the place itself comes first. A longer label has to end in it: 成都市第一中学 is a school. */
function matchPlaceName(name: string, level: PlaceLevel, region: Region, options: OptionInfo[]): OptionMatch {
  const usable = options.flatMap((o, i) => (o.disabled || isPlaceholderOption(o) ? [] : [i]));
  const only = (hits: number[], confidence: number): OptionMatch | null =>
    hits.length === 1 ? { status: 'matched', index: hits[0]!, confidence } : null;
  const lastPart = (label: string) => label.trim().split(/[/,，\s·-]+/).pop() ?? '';
  const found =
    only(usable.filter((i) => options[i]!.label.trim() === name.trim()), 0.95) ??
    only(usable.filter((i) => isSamePlace(name, options[i]!.label, level)), 0.92) ??
    (hasCjk(name) ? only(usable.filter((i) => isSamePlace(name, lastPart(options[i]!.label), level)), 0.85) : null);
  if (found) return found;
  const m = matchPlace(name, region, options);
  if (m.status !== 'matched' || !hasCjk(name)) return m;
  return options[m.index]!.label.trim().endsWith(name.trim()) ? m : { status: 'none' };
}

/**
 * A place from a search box. It must be named by the rest of the address: a search that finds only
 * "Brisbane CA, USA" has not found this Brisbane. Several left: narrow by country, then by state.
 */
function matchPlace(name: string, region: Region, options: OptionInfo[]): OptionMatch {
  const found = placeOptions(name, options);
  if (found.length === 0) {
    const m = matchOption(null, name, options);
    // A plain list says the name and nothing else. "Melbourne Beach, FL" only starts like it.
    if (m.status !== 'matched' || hasCjk(name)) return m;
    return options[m.index]!.label.trim().toLowerCase() === name.trim().toLowerCase() ? m : { status: 'none' };
  }
  const country = region.country?.trim() ?? '';
  const province = region.province?.trim() ?? '';
  const hits = found.filter((i) => {
    const label = options[i]!.label;
    if (country && isInOtherCountry(label, country)) return false;
    return !province || !namesOtherState(label.slice(name.length), province, country);
  });
  const parts = [country, province].filter(Boolean);
  const names = (i: number, part: string): boolean =>
    placeSpellings(part, country).some((spelling) => namesPlace(options[i]!.label, spelling));
  // Nothing to check a result against: it could be any place of that name.
  if (parts.length === 0) return hits.length > 0 ? { status: 'ambiguous', candidates: hits } : { status: 'none' };
  let left = hits.filter((i) => parts.some((part) => names(i, part)));
  if (left.length === 0) return { status: 'none' };
  for (const part of parts) {
    const narrowed = left.filter((i) => names(i, part));
    if (narrowed.length > 0) left = narrowed;
  }
  return left.length === 1 ? { status: 'matched', index: left[0]!, confidence: 0.8 } : { status: 'ambiguous', candidates: left };
}

function regionText(region: Region, locale: Locale): string {
  const path = regionPath(region);
  return locale === 'zh-CN' ? path.join('') : [...path].reverse().join(', ');
}

/** The format a question gives in brackets after it: 目前所在地（填写格式：XX省XX市）. */
const FORMAT_HINT = /[（(]\s*(?:填写|书写)?格式(?:为)?\s*[:：]([^)）]*)[)）]/;

/**
 * A place as a text box asks for it. A format in brackets that stops at a level (XX省XX市, xx省) says how far down
 * to write; without one, the whole place goes in.
 */
function regionTextAsked(region: Region, locale: Locale, askedAs: string | undefined): string {
  const format = FORMAT_HINT.exec(askedAs ?? '')?.[1];
  if (locale !== 'zh-CN' || !format || /[区县]/.test(format)) return regionText(region, locale);
  const levels = /市/.test(format) ? [region.province, region.city] : /省/.test(format) ? [region.province] : null;
  const parts = levels?.map((p) => p?.trim() ?? '').filter(Boolean) ?? [];
  return parts.length > 0 ? parts.join('') : regionText(region, locale);
}

/**
 * Translate a resolved value into what a driver should do with `control`; null when the control cannot
 * take this kind of value (e.g. a file for a text box).
 */
const DEGREE_AWARD_ZH: Record<string, string> = { bachelor: '学士', master: '硕士', phd: '博士' };

export function toIntent(
  def: FieldKeyDef,
  raw: RawValue,
  control: Control,
  locale: Locale,
  opts: IntentOptions = {},
): FillIntent | null {
  const domain = domainFor(def);
  const kind = control.kind;

  if (def.type === 'file') {
    if (kind !== 'file' || typeof raw !== 'string') return null;
    const file = opts.files?.[raw];
    return file ? { kind: 'file', file } : null;
  }
  if (kind === 'file') return null;

  if (kind === 'checkbox' && !control.options) {
    return def.type === 'bool' && typeof raw === 'boolean' ? { kind: 'check', checked: raw } : null;
  }
  if (def.type === 'period') {
    if (typeof raw !== 'string') return null;
    const [start = '', end = ''] = raw.split('/');
    if (kind === 'date') {
      const [from, to] = control.dateRange ? [dateIntent(start, control), dateIntent(end, control)] : [null, null];
      const saysStillGoing = control.lib === 'feishu' || control.lib === 'native' || (control.lib === 'moka' && control.el.querySelector('input[type=checkbox]') !== null);
      if (from?.kind === 'date' && end === STILL_GOING && saysStillGoing) {
        return { kind: 'dateFrom', display: `${from.display} ~ ${locale === 'zh-CN' ? '至今' : 'Present'}`, start: from };
      }
      if (from?.kind !== 'date' || to?.kind !== 'date') return null;
      return { kind: 'dateRange', display: `${from.display} ~ ${to.display}`, start: from, end: to };
    }
    const text = isTextLike(control) ? periodText(start, end, locale) : null;
    return text === null ? null : { kind: 'text', text };
  }
  if (kind === 'date') {
    return def.type === 'date' && !control.dateRange && typeof raw === 'string' ? dateIntent(raw, control) : null;
  }

  switch (def.type) {
    case 'bool': {
      if (typeof raw !== 'boolean') return null;
      const label = optionLabel('yesNo', raw ? 'yes' : 'no', locale);
      if (hasPickList(control)) return choice('yesNo', raw, label);
      return isTextLike(control) ? { kind: 'text', text: label } : null;
    }
    case 'enum': {
      if (typeof raw !== 'string') return null;
      const label = optionLabel(domain, raw, locale);
      if (def.key === 'basics.gender' && opts.genderAnswer === 'prefer_not_to_say' && hasPickList(control)) {
        // Only the question itself can say that declining is allowed, and a list may not be open yet.
        const match: OptionMatcher = (options) => {
          const decline = matchOption(domain, 'undisclosed', options);
          return decline.status === 'none' ? matchOption(domain, raw, options) : decline;
        };
        const known = control.options ? match(control.options) : null;
        const display = known?.status === 'matched' ? control.options![known.index]!.label : label;
        // A list that loads as you type must not be handed the answer being kept back.
        const query = optionLabel(domain, 'undisclosed', locale);
        return control.multiple
          ? { kind: 'multi', display, items: [{ query, match }] }
          : { kind: 'choice', display, query, match };
      }
      if (hasPickList(control)) {
        return control.multiple
          ? { kind: 'multi', display: label, items: [{ query: label, match: (o) => matchOption(domain, raw, o) }] }
          : { kind: 'choice', display: label, query: label, match: (o) => matchOption(domain, raw, o) };
      }
      if (def.key === 'education.degree' && isTextLike(control) && locale === 'zh-CN' && /学位/.test(opts.askedAs ?? '') && !/学历/.test(opts.askedAs ?? '')) {
        // 学位 typed out is 学士, not 本科. Below that there is none to name, and none is made up.
        const award = DEGREE_AWARD_ZH[raw];
        return award ? { kind: 'text', text: award } : null;
      }
      return isTextLike(control) ? { kind: 'text', text: label } : null;
    }
    case 'list': {
      const items = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : null;
      if (!items || items.length === 0) return null;
      if (hasPickList(control)) return multiOrChoice(domain, items, control);
      if (kind === 'cascader') return { kind: 'cascade', display: items[0]!, path: [items[0]!] };
      return { kind: 'text', text: items[0]! };
    }
    case 'region': {
      if (typeof raw !== 'object' || Array.isArray(raw)) return null;
      const region = raw as Region;
      const path = regionPath(region);
      if (path.length === 0) return null;
      if (kind === 'cascader') return { kind: 'cascade', display: regionText(region, locale), path };
      if (hasPickList(control)) {
        const named: [string | undefined, PlaceLevel][] = [
          [region.district, 'district'],
          [region.city, 'city'],
          [region.province, 'province'],
        ];
        const levels = named.flatMap(([name, level]) => (name?.trim() ? [{ query: name.trim(), level }] : []));
        const [first, ...up] = levels.length > 0 ? levels : [{ query: path[0]!, level: 'province' as const }];
        const asked = ({ query, level }: { query: string; level: PlaceLevel }) => ({
          query,
          match: (options: OptionInfo[]) => matchPlaceName(query, level, region, options),
        });
        const own = asked(first!);
        const wider = up.map(asked);
        // A list of a few big cities, and this place is not one of them nor in a state it lists: it is "Other".
        // Only when nothing on the list could be this place, so a driver walking up the levels still gets them.
        const match: OptionMatcher = (options) => {
          const m = own.match(options);
          if (m.status !== 'none' || wider.some((w) => w.match(options).status !== 'none')) return m;
          return otherPlace(options);
        };
        return { kind: 'choice', display: first!.query, query: own.query, match, ...(wider.length > 0 ? { wider } : {}) };
      }
      return { kind: 'text', text: regionTextAsked(region, locale, opts.askedAs) };
    }
    case 'date': {
      if (typeof raw !== 'string' || !isTextLike(control)) return null;
      const pattern = control.el.getAttribute('placeholder');
      const date = pattern && isDatePattern(pattern) ? parseDate(raw) : null;
      return { kind: 'text', text: date ? formatByPattern(pattern!, date) : raw };
    }
    default: {
      // text, longtext, number
      if (typeof raw === 'object') return null;
      const text = formatWithPreset(def.key, String(raw), locale, opts.presetId ?? 'default', opts.presetCtx);
      if (def.key === 'education.classYear') {
        const year = new RegExp(`(?<!\\d)${text}(?!\\d)`);
        if (!hasPickList(control)) return isTextLike(control) ? { kind: 'text', text: locale === 'zh-CN' ? `${text}届` : text } : null;
        const match: OptionMatcher = (options) => {
          const hits = options.flatMap((o, index) => (year.test(o.label) ? [index] : []));
          if (hits.length === 1) return { status: 'matched', index: hits[0]!, confidence: 1 };
          return hits.length > 1 ? { status: 'ambiguous', candidates: hits } : { status: 'none' };
        };
        return { kind: 'choice', display: `${text}届`, query: text, match };
      }
      if (def.key === 'contact.phone' && opts.dialCode && isTextLike(control)) {
        const shown = dialCodeShown(control.el);
        // A bare number would be read as a number of the country the widget shows.
        if (shown && shown !== opts.dialCode.replace(/\D/g, '')) return { kind: 'text', text: withDialCode(opts.dialCode, text) };
      }
      if (def.key === 'contact.addressCity' && opts.home && hasPickList(control) && !control.multiple) {
        const home = opts.home;
        return { kind: 'choice', display: text, query: text, match: (options) => matchPlace(text, home, options) };
      }
      if (def.key === 'contact.phoneCountryCode' && hasPickList(control) && !control.multiple) {
        const country = opts.home?.country ?? '';
        const match: OptionMatcher = (options) => {
          const m = matchOption(null, text, options);
          if (m.status !== 'ambiguous' || !country) return m;
          // +61 is also two islands, and +1 is two countries: the applicant's own country settles it.
          const own = matchOption(null, country, m.candidates.map((i) => options[i]!));
          return own.status === 'matched' ? { ...own, index: m.candidates[own.index]! } : m;
        };
        return { kind: 'choice', display: text, query: text, match };
      }
      if (def.key === 'contact.addressProvince' && hasPickList(control) && !control.multiple) {
        const spellings = placeSpellings(text, opts.home?.country ?? '');
        const match: OptionMatcher = (options) => {
          for (const spelling of spellings) {
            const m = matchOption(null, spelling, options);
            if (m.status !== 'none') return m;
          }
          return { status: 'none' };
        };
        return { kind: 'choice', display: text, query: text, match };
      }
      if (hasPickList(control)) return multiOrChoice(domain, [text], control);
      if (kind === 'cascader') return { kind: 'cascade', display: text, path: [text] };
      return { kind: 'text', text };
    }
  }
}
