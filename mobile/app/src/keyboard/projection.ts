// The resume keyboard's projection: profile + app state → KeyboardData (keyboardData.ts).
// Values go through the fill engine's own functions (resolveValue, entryFieldText, optionLabel), so the keyboard types
// what the fill browser would. Enums are rendered in the resume's language; labels and titles in the UI language.
// Left out on purpose: attachments, basics.idNumber and idType, the diversity module, yes/no answers,
// timestamps and real resume ids. Pure.
import { MODULES, getByPath, type FieldMeta, type ModuleName } from '../../../../src/editor';
import type { FieldKey } from '../../../../src/engine/types';
import { domainFor, entryFieldText, optionLabel, resolveValue } from '../../../../src/engine/values';
import type { Language } from '../../../../src/i18n';
import type { Locale, Profile, Region, Resume } from '../../../../src/schema';
import { getFieldKeyDef } from '../../../../src/schema/fieldKeys';
import { resolveFillResume } from '../home/summary';
import { mt } from '../i18n';
import type { FillLanguage } from '../store/appStateStore';
import {
  KB_LIMITS,
  KEYBOARD_DATA_VERSION,
  KEYBOARD_GROUP_IDS,
  type KbGroup,
  type KbItem,
  type KbResume,
  type KbSection,
  type KeyboardData,
  type KeyboardGroupId,
  type KeyboardKind,
} from './keyboardData';

/** Even after dropping to the default resume and its counterpart, the JSON is over KB_LIMITS.jsonBytes. */
export class KeyboardDataTooLarge extends Error {
  constructor() {
    super('Keyboard data is too large');
    this.name = 'KeyboardDataTooLarge';
  }
}

const ZH_DIGITS = ['一', '二', '三', '四', '五', '六', '七', '八', '九', '十'];

/** 1..10 → 一..十, anything else as digits. */
export function zhOrdinal(n: number): string {
  return Number.isInteger(n) && n >= 1 && n <= 10 ? ZH_DIGITS[n - 1]! : String(n);
}

type Lang = 'zh' | 'en';
const langOf = (r: Resume): Lang => (r.locale.startsWith('zh') ? 'zh' : 'en');

/**
 * The resume the 中/EN toggle goes to from `resume`, among `pool`: its linked resume when that is in the pool and in
 * the other language, else the first in the other language, else null. Restates `counterpartResume` of
 * src/storage/profileRepo.ts, which cannot be imported here (it reads browser.storage).
 */
function counterpartAmong(pool: readonly Resume[], resume: Resume): Resume | null {
  const other = (r: Resume) => r.id !== resume.id && langOf(r) !== langOf(resume);
  const linked = pool.find((r) => r.id === resume.linkedResumeId);
  return linked && other(linked) ? linked : (pool.find(other) ?? null);
}

/** `counterpartResume` (src/storage/profileRepo.ts) with `resume` as the active one. */
export function counterpartOf(profile: Profile, resume: Resume): Resume | null {
  return counterpartAmong(profile.resumes, resume);
}

// ---- text helpers ---------------------------------------------------------------------------------------

/** At most `max` UTF-16 units, never splitting a surrogate pair, trimmed. */
function cut(text: string, max: number): string {
  let s = text.trim();
  if (s.length <= max) return s;
  let end = max;
  const last = s.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  s = s.slice(0, end).trim();
  return s;
}

const joinList = (parts: readonly string[], lang: Lang) => parts.join(lang === 'zh' ? '、' : ', ');

function regionText(region: Region | undefined, lang: Lang): string {
  if (!region) return '';
  const parts = [region.country, region.province, region.city, region.district]
    .map((p) => (p ?? '').trim())
    .filter((p, i, all) => p !== '' && p !== all[i - 1]);
  return lang === 'zh' ? parts.join('') : parts.reverse().join(', ');
}

/** The rule of periodText in src/engine/values.ts (private there), copied: zh 2022.09-2026.06 / 2022.09-至今, en
 *  2022-09 - 2026-06 / 2022-09 - Present. Null without a start, or without an end on an entry that is not current. */
function periodText(entry: { startDate?: string | null; endDate?: string | null; current?: boolean }, locale: Locale): string | null {
  const start = (entry.startDate ?? '').trim();
  if (!start) return null;
  const endRaw = (entry.endDate ?? '').trim();
  const now = !endRaw && entry.current === true;
  if (!endRaw && !now) return null;
  if (locale === 'zh-CN') return `${start.replaceAll('-', '.')}-${now ? '至今' : endRaw.replaceAll('-', '.')}`;
  return `${start} - ${now ? 'Present' : endRaw}`;
}

// ---- field metadata -------------------------------------------------------------------------------------

function fieldMeta(module: ModuleName, key: string): FieldMeta {
  const meta = MODULES.find((m) => m.module === module)?.fields.find((f) => f.key === key);
  if (!meta) throw new Error(`keyboard projection: unknown field ${module}.${key}`);
  return meta;
}

const moduleLabel = (ui: Language, module: ModuleName) => mt(ui, `options.module.${module}`);

/** A field of an object module (basics, contact, jobIntention, workRights, emergencyContact) or the root (about). */
function objectValue(resume: Resume, module: ModuleName, key: string): string {
  const meta = fieldMeta(module, key);
  const container = module === 'about' ? resume : (resume as unknown as Record<string, unknown>)[module];
  const raw = getByPath(container, key);
  const lang = langOf(resume);
  switch (meta.input) {
    case 'bool':
      return '';
    case 'region':
      return regionText(raw as Region | undefined, lang);
    case 'list':
      return Array.isArray(raw) ? joinList(raw.filter((x): x is string => typeof x === 'string' && x.trim() !== '').map((x) => x.trim()), lang) : '';
    case 'number':
      return typeof raw === 'number' && Number.isFinite(raw) ? String(raw) : '';
    case 'select': {
      if (typeof raw !== 'string' || raw.trim() === '') return '';
      const def = getFieldKeyDef(`${module}.${key}` as FieldKey);
      return optionLabel((def ? domainFor(def) : null) ?? meta.enumDomain ?? null, raw, resume.locale);
    }
    default:
      return typeof raw === 'string' ? raw : '';
  }
}

/** A field of an array entry: enums by their label in the resume's language, dates as stored, a current entry's
 *  end as 至今 / Present. */
function entryValue(resume: Resume, module: ModuleName, key: string, entry: Record<string, unknown>): string {
  if (key === 'endDate' && entry.current === true && !(typeof entry.endDate === 'string' && entry.endDate.trim())) {
    return mt(langOf(resume), 'options.present');
  }
  return entryFieldText(module, key, entry, resume.locale);
}

// ---- items and sections ---------------------------------------------------------------------------------

interface Draft {
  field: string;
  label: string;
  value: string;
  kinds: KeyboardKind[];
}
interface DraftSection {
  title: string | null;
  a11y: string | null;
  items: Draft[];
}

function push(items: Draft[], field: string, label: string, value: string, kinds: KeyboardKind[] = []): void {
  const v = cut(value, KB_LIMITS.value);
  if (v) items.push({ field, label: cut(label, KB_LIMITS.label), value: v, kinds });
}

type Spec = readonly [key: string, kinds?: KeyboardKind[]];

function objectItems(ui: Language, resume: Resume, module: ModuleName, specs: readonly Spec[], items: Draft[] = []): Draft[] {
  for (const [key, kinds] of specs) push(items, key, mt(ui, fieldMeta(module, key).labelKey), objectValue(resume, module, key), kinds);
  return items;
}

function derivedValue(key: string, resume: Resume): string {
  const v = resolveValue(key as FieldKey, resume, 0, null)?.raw;
  return typeof v === 'string' ? v : '';
}

const PERIOD = 'period';

function entryItems(ui: Language, resume: Resume, module: ModuleName, entry: Record<string, unknown>, specs: readonly Spec[]): Draft[] {
  const items: Draft[] = [];
  for (const [key, kinds] of specs) {
    if (key === PERIOD) {
      push(items, PERIOD, mt(ui, 'm.kb.item.period'), periodText(entry, resume.locale) ?? '');
      continue;
    }
    push(items, key, mt(ui, fieldMeta(module, key).labelKey), entryValue(resume, module, key, entry), kinds);
  }
  return items;
}

const nth = (ui: Language, key: string, n: number) => mt(ui, key, { n: ui === 'zh' ? zhOrdinal(n) : n });
const titled = (ui: Language, first: string, name: string) => cut(mt(ui, 'm.kb.entry.titled', { nth: first, name }), KB_LIMITS.sectionTitle);

/** One section per entry, titled 「第一段 · 示例大学」 (or just 「第一段」 with no name). */
function entrySections(
  ui: Language,
  resume: Resume,
  module: ModuleName,
  entries: readonly unknown[],
  specs: readonly Spec[],
  nameOf: (e: Record<string, unknown>) => string,
): DraftSection[] {
  const out: DraftSection[] = [];
  for (const raw of entries) {
    const entry = raw as Record<string, unknown>;
    const items = entryItems(ui, resume, module, entry, specs);
    if (items.length === 0) continue;
    const ordinal = nth(ui, 'm.kb.entry.nth', out.length + 1);
    const name = nameOf(entry).trim();
    out.push({ title: name ? titled(ui, ordinal, name) : ordinal, a11y: ordinal, items });
  }
  return out;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');

const DATED: readonly Spec[] = [['startDate', ['date']], ['endDate', ['date']], [PERIOD]];
const WORK: readonly Spec[] = [['company', ['company']], ['position', ['position']], ['department'], ['city', ['address']], ...DATED, ['description']];

function basicsGroup(ui: Language, r: Resume): DraftSection[] {
  const items: Draft[] = [];
  const phone = r.contact.phone.trim();
  push(items, 'fullName', mt(ui, 'm.kb.item.fullName'), derivedValue('basics.fullName', r), ['name']);
  objectItems(ui, r, 'contact', [['phone', ['phone', 'number']]], items);
  const full = derivedValue('contact.phoneFull', r);
  if (full !== phone) push(items, 'phoneFull', mt(ui, 'm.kb.item.phoneFull'), full, ['phone']);
  // The code has a default (+86), so it counts only next to a number.
  if (phone) objectItems(ui, r, 'contact', [['phoneCountryCode', ['phone']]], items);
  objectItems(ui, r, 'contact', [['email', ['email']], ['wechat', ['wechat']], ['qq', ['qq', 'number']]], items);
  objectItems(
    ui,
    r,
    'basics',
    [
      ['familyName', ['name']], ['givenName', ['name']], ['englishName', ['name']], ['preferredName', ['name']], ['pronouns'],
      ['gender'], ['birthDate', ['date']], ['nationality'], ['ethnicity'], ['politicalStatus'], ['partyJoinDate', ['date']],
      ['maritalStatus'], ['height', ['number']], ['weight', ['number']], ['nativePlace', ['address']], ['studentOrigin', ['address']],
      ['household', ['address']], ['currentLocation', ['address']],
    ],
    items,
  );
  push(items, 'addressFull', mt(ui, 'm.kb.item.addressFull'), derivedValue('contact.addressFull', r), ['address']);
  objectItems(
    ui,
    r,
    'contact',
    [
      ['address.country', ['address']], ['address.province', ['address']], ['address.city', ['address']],
      ['address.district', ['address']], ['address.street', ['address']], ['address.postcode', ['postcode', 'number']],
    ],
    items,
  );
  return [{ title: null, a11y: null, items }];
}

function skillsGroup(ui: Language, r: Resume): DraftSection[] {
  const out: DraftSection[] = [];
  const lang = langOf(r);
  const skills = r.skills.map((s) => ({ name: s.name.trim(), level: s.level.trim() })).filter((s) => s.name);
  if (skills.length > 0) {
    const items: Draft[] = [];
    push(items, 'allSkills', mt(ui, 'm.kb.item.allSkills'), joinList(skills.map((s) => s.name), lang));
    skills.forEach((s, i) => {
      const value = s.level ? (lang === 'zh' ? `${s.name}（${s.level}）` : `${s.name} (${s.level})`) : s.name;
      push(items, `skill${i + 1}`, mt(ui, 'm.kb.item.skillN', { n: i + 1 }), value);
    });
    const label = moduleLabel(ui, 'skills');
    out.push({ title: label, a11y: label, items });
  }
  const listed = (module: ModuleName, entries: readonly unknown[], specs: readonly Spec[], nameKey: string) => {
    const label = moduleLabel(ui, module);
    let n = 0;
    for (const raw of entries) {
      const entry = raw as Record<string, unknown>;
      const items = entryItems(ui, r, module, entry, specs);
      if (items.length === 0) continue;
      n += 1;
      const name = str(entry[nameKey]);
      out.push({ title: name ? titled(ui, label, name) : cut(`${label} ${n}`, KB_LIMITS.sectionTitle), a11y: `${label} ${n}`, items });
    }
  };
  listed('languages', r.languages, [['language'], ['proficiency'], ['certificate'], ['score', ['number']]], 'language');
  listed('certificates', r.certificates, [['name'], ['date', ['date']], ['issuer'], ['number']], 'name');
  return out;
}

function aboutGroup(ui: Language, r: Resume): DraftSection[] {
  const out: DraftSection[] = [];
  const intro = objectItems(ui, r, 'about', [['selfIntroduction'], ['hobbies']]);
  if (intro.length > 0) out.push({ title: null, a11y: null, items: intro });
  let n = 0;
  for (const a of r.customAnswers) {
    const items: Draft[] = [];
    push(items, 'answer', mt(ui, 'm.kb.item.answer'), a.answer);
    if (items.length === 0) continue;
    n += 1;
    const label = mt(ui, 'm.kb.entry.question', { n });
    const question = cut(a.question, KB_LIMITS.sectionTitle);
    out.push({ title: question || label, a11y: label, items });
  }
  return out;
}

function otherGroup(ui: Language, r: Resume): DraftSection[] {
  const out: DraftSection[] = [];
  const single = (module: ModuleName, items: Draft[]) => {
    const label = moduleLabel(ui, module);
    if (items.length > 0) out.push({ title: label, a11y: label, items });
  };
  single('emergencyContact', objectItems(ui, r, 'emergencyContact', [['name', ['name']], ['relationship'], ['phone', ['phone', 'number']]]));
  const people = (module: ModuleName, entries: readonly unknown[], specs: readonly Spec[]) => {
    const label = moduleLabel(ui, module);
    let n = 0;
    for (const raw of entries) {
      const items = entryItems(ui, r, module, raw as Record<string, unknown>, specs);
      if (items.length === 0) continue;
      n += 1;
      const person = nth(ui, 'm.kb.entry.person', n);
      out.push({ title: titled(ui, label, person), a11y: cut(ui === 'zh' ? `${label}${person}` : `${label} ${person}`, KB_LIMITS.sectionTitle), items });
    }
  };
  people('family', r.family, [
    ['name', ['name']], ['relationship'], ['employer', ['company']], ['position', ['position']], ['phone', ['phone', 'number']], ['politicalStatus'],
  ]);
  people('referees', r.referees, [
    ['name', ['name']], ['title', ['position']], ['company', ['company']], ['email', ['email']], ['phone', ['phone', 'number']], ['relationship'],
  ]);
  single('workRights', objectItems(ui, r, 'workRights', [['status'], ['visaType'], ['visaExpiry', ['date']]]));
  return out;
}

function groupSections(id: KeyboardGroupId, ui: Language, r: Resume): DraftSection[] {
  switch (id) {
    case 'basics':
      return basicsGroup(ui, r);
    case 'education':
      return entrySections(
        ui,
        r,
        'education',
        r.education,
        [
          ['school', ['school']], ['schoolEn', ['school']], ['major', ['major']], ['minor', ['major']], ['department'], ['degree'],
          ['educationType'], ...DATED, ['gpa', ['number']], ['gpaScale', ['number']], ['ranking'], ['courses'], ['thesis'], ['honors'],
          ['country', ['address']], ['city', ['address']],
        ],
        (e) => str(e.school) || str(e.schoolEn) || (str(e.degree) ? entryValue(r, 'education', 'degree', e) : ''),
      );
    case 'internship':
      return entrySections(ui, r, 'work', r.work.filter((w) => w.kind === 'internship'), WORK, (e) => str(e.company));
    case 'work':
      return entrySections(ui, r, 'work', r.work.filter((w) => w.kind !== 'internship'), WORK, (e) => str(e.company));
    case 'projects':
      return entrySections(ui, r, 'projects', r.projects, [['name'], ['role', ['position']], ...DATED, ['description'], ['link', ['url']]], (e) => str(e.name));
    case 'campus':
      return entrySections(ui, r, 'campus', r.campus, [['organization', ['company']], ['role', ['position']], ...DATED, ['description']], (e) => str(e.organization));
    case 'awards':
      return entrySections(ui, r, 'awards', r.awards, [['name'], ['date', ['date']], ['level'], ['issuer'], ['description']], (e) => str(e.name));
    case 'skills':
      return skillsGroup(ui, r);
    case 'intention': {
      const items = objectItems(ui, r, 'jobIntention', [
        ['positions', ['position']], ['cities', ['address']], ['industry'], ['employmentType'], ['salaryMin', ['number']], ['salaryMax', ['number']],
        ['salaryCurrency'], ['salaryPeriod'], ['availableFrom', ['date']], ['noticePeriod'], ['howDidYouHear'],
      ]);
      return [{ title: null, a11y: null, items }];
    }
    case 'links': {
      const items = objectItems(ui, r, 'contact', [['linkedin', ['url']], ['github', ['url']], ['portfolio', ['url']], ['website', ['url']]]);
      return [{ title: null, a11y: null, items }];
    }
    case 'about':
      return aboutGroup(ui, r);
    case 'other':
      return otherGroup(ui, r);
  }
}

/** Cut from the end of these groups first when a resume holds more than KB_LIMITS.itemsPerResume items. */
const CUT_FIRST: readonly KeyboardGroupId[] = ['other', 'about', 'skills'];

function limitItems(groups: { id: KeyboardGroupId; sections: DraftSection[] }[]): void {
  let total = groups.reduce((n, g) => n + g.sections.reduce((m, s) => m + s.items.length, 0), 0);
  const order = [...CUT_FIRST, ...[...KEYBOARD_GROUP_IDS].reverse().filter((id) => !CUT_FIRST.includes(id))];
  for (const id of order) {
    const g = groups.find((x) => x.id === id);
    if (!g) continue;
    for (let s = g.sections.length - 1; s >= 0 && total > KB_LIMITS.itemsPerResume; s -= 1) {
      const section = g.sections[s]!;
      const drop = Math.min(section.items.length, total - KB_LIMITS.itemsPerResume);
      section.items.splice(section.items.length - drop, drop);
      total -= drop;
      if (section.items.length === 0) g.sections.splice(s, 1);
    }
    if (total <= KB_LIMITS.itemsPerResume) break;
  }
}

function buildGroups(r: Resume, ui: Language, hidden: ReadonlySet<KeyboardGroupId>): KbGroup[] {
  const drafts = KEYBOARD_GROUP_IDS.filter((id) => !hidden.has(id))
    .map((id) => ({ id, sections: groupSections(id, ui, r).filter((s) => s.items.length > 0) }))
    .filter((g) => g.sections.length > 0);
  limitItems(drafts);
  return drafts
    .filter((g) => g.sections.length > 0)
    .map((g) => ({
      id: g.id,
      label: mt(ui, `m.kb.group.${g.id}`),
      sections: g.sections.map(
        (s, si): KbSection => ({
          title: s.title,
          a11y: s.a11y,
          items: s.items.map((d): KbItem => ({ id: `${g.id}.${si}.${d.field}`, label: d.label, value: d.value, kinds: d.kinds })),
        }),
      ),
    }));
}

// ---- resumes ---------------------------------------------------------------------------------------------

interface Kept {
  resume: Resume;
  groups: KbGroup[];
}

/**
 * The keyboard's id for a resume: 'r' and the FNV-1a hash of the real id as 8 hex digits. It stays the same when
 * other resumes are deleted or reordered, so a choice made in the keyboard keeps naming the same resume,
 * and the real id never leaves the app.
 */
export function keyboardResumeId(realId: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < realId.length; i++) {
    h ^= realId.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `r${h.toString(16).padStart(8, '0')}`;
}

function assemble(ui: Language, list: readonly Kept[], chosen: Kept): KeyboardData {
  const pool = list.map((k) => k.resume);
  // A hash collision (about one in four billion per pair) falls back to the position for the later resume.
  const ids = new Map<Resume, string>();
  for (const [i, r] of pool.entries()) {
    const id = keyboardResumeId(r.id);
    ids.set(r, [...ids.values()].includes(id) ? `r${i}` : id);
  }
  const idOf = (r: Resume) => ids.get(r)!;
  const resumes = list.map(
    (k): KbResume => {
      const lang = langOf(k.resume);
      const other = counterpartAmong(pool, k.resume);
      return {
        id: idOf(k.resume),
        title: cut(k.resume.title, KB_LIMITS.resumeTitle) || mt(ui, `m.defaultTitle.${lang}`),
        lang,
        counterpart: other ? idOf(other) : null,
        groups: k.groups,
      };
    },
  );
  return { v: KEYBOARD_DATA_VERSION, ui, defaultResume: idOf(chosen.resume), resumes };
}

const utf8Length = (text: string) => new TextEncoder().encode(text).length;

/** Null when no resume has a single item left (the caller clears the keyboard file). Throws KeyboardDataTooLarge
 *  when even the default resume and its counterpart are over KB_LIMITS.jsonBytes. */
export function buildKeyboardData(
  profile: Profile,
  o: { language: Language; fillLanguage: FillLanguage; hidden: readonly KeyboardGroupId[] },
): KeyboardData | null {
  const ui = o.language;
  const hidden = new Set(o.hidden);
  const kept: Kept[] = profile.resumes.map((resume) => ({ resume, groups: buildGroups(resume, ui, hidden) })).filter((k) => k.groups.length > 0);
  if (kept.length === 0) return null;

  const fill = resolveFillResume(profile, o.fillLanguage)?.resume;
  const chosen = kept.find((k) => k.resume === fill) ?? kept[0]!;
  const partnerOf = (k: Kept) => {
    const other = counterpartAmong(kept.map((x) => x.resume), k.resume);
    return other ? kept.find((x) => x.resume === other)! : null;
  };
  const partner = partnerOf(chosen);
  const pair = new Set<Kept>([chosen, ...(partner ? [partner] : [])]);
  const inOrder = (set: ReadonlySet<Kept>) => kept.filter((k) => set.has(k));

  let list = kept;
  if (kept.length > KB_LIMITS.resumes) {
    const picked = new Set(pair);
    for (const k of kept) {
      if (picked.size >= KB_LIMITS.resumes) break;
      picked.add(k);
    }
    list = inOrder(picked);
  }
  let data = assemble(ui, list, chosen);
  if (utf8Length(JSON.stringify(data)) > KB_LIMITS.jsonBytes) {
    data = assemble(ui, inOrder(pair), chosen);
    if (utf8Length(JSON.stringify(data)) > KB_LIMITS.jsonBytes) throw new KeyboardDataTooLarge();
  }
  return data;
}
