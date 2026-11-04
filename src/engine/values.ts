// Values: resume data for a field key (resolveValue) and its translation into a driver intent (toIntent).
import { OPTION_SYNONYMS, hasCjk, isInOtherCountry, matchOption, namesOtherState, placeOptions, placeSpellings } from '../dictionary';
import type { FileData, FillIntent, OptionMatch, OptionMatcher } from '../drivers/types';
import type { GenderAnswer, Locale, Region, Resume } from '../schema';
import type { FieldKeyDef } from '../schema/fieldKeys';
import type { Control, FieldKey, OptionInfo, SectionKey } from './types';

const escapeRegExp = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

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
export function sectionEntries(
  resume: Resume,
  module: ArrayModule,
  section: SectionKey | null,
  hasInternshipSection = false,
): EntryRef<unknown>[] {
  const all = (resume[module] as unknown[]).map((entry, index) => ({ entry, index }));
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

function ageOf(birthDate: string, now: Date): number | null {
  const m = /^(\d{4})-(\d{2})(?:-(\d{2}))?$/.exec(birthDate);
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3] ?? 1)];
  let age = now.getFullYear() - y;
  if (now.getMonth() + 1 < mo || (now.getMonth() + 1 === mo && now.getDate() < d)) age -= 1;
  return age >= 0 ? age : null;
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
    case 'basics.age': {
      const age = ageOf(basics.birthDate, opts.now ?? new Date());
      return age === null ? null : { raw: age, source: 'basics.birthDate' };
    }
    case 'contact.phoneFull': {
      const phone = contact.phone.trim();
      if (!phone) return null;
      const cc = contact.phoneCountryCode.trim();
      // National numbers drop their trunk 0 behind a country code (+61 0412… → +61 412…).
      const national = cc && cc !== '+86' ? phone.replace(/^0/, '') : phone;
      return { raw: cc ? `${cc} ${national}` : national, source: 'contact.phoneCountryCode+phone' };
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
  if (ARRAY_MODULES.has(module)) {
    const rows = sectionEntries(resume, module as ArrayModule, section, opts.hasInternshipSection);
    const row = rows[entryIndex];
    if (!row) return null;
    const entry = row.entry as Record<string, unknown>;
    const source = `${module}[${row.index}].${field}`;
    if (field === 'endDate' && entry.current === true && !entry.endDate) return null;
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

export interface IntentOptions {
  /** Attachment files by id (the run payload's `files`). */
  files?: Record<string, FileData>;
  /** The home address, to tell which of several places of one name is meant. */
  home?: Region;
  /** How to answer a gender question that offers a way to decline. Without it: from the resume. */
  genderAnswer?: GenderAnswer;
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
  return choice(domain, values[0]!, values[0]!);
}

/** Region parts in the order a person writes them: zh 浙江省杭州市西湖区, en "Brisbane, QLD". */
function regionPath(region: Region): string[] {
  const parts = [region.province, region.city, region.district].map((p) => p?.trim() ?? '').filter(Boolean);
  if (parts.length === 0 && region.country?.trim()) return [region.country.trim()];
  return parts;
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
    placeSpellings(part, country).some((spelling) =>
      new RegExp(`(?:^|[^\\p{L}])${escapeRegExp(spelling)}(?:$|[^\\p{L}])`, 'iu').test(options[i]!.label),
    );
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

/**
 * Translate a resolved value into what a driver should do with `control`; null when the control cannot
 * take this kind of value (e.g. a file for a text box).
 */
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
  if (kind === 'date') {
    return def.type === 'date' && typeof raw === 'string' ? dateIntent(raw, control) : null;
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
        const name = path[path.length - 1]!;
        return { kind: 'choice', display: name, query: name, match: (options) => matchPlace(name, region, options) };
      }
      return { kind: 'text', text: regionText(region, locale) };
    }
    case 'date': {
      if (typeof raw !== 'string') return null;
      return isTextLike(control) ? { kind: 'text', text: raw } : null;
    }
    default: {
      // text, longtext, number
      if (typeof raw === 'object') return null;
      const text = String(raw);
      if (def.key === 'contact.addressCity' && opts.home && hasPickList(control) && !control.multiple) {
        const home = opts.home;
        return { kind: 'choice', display: text, query: text, match: (options) => matchPlace(text, home, options) };
      }
      if (hasPickList(control)) return multiOrChoice(domain, [text], control);
      if (kind === 'cascader') return { kind: 'cascade', display: text, path: [text] };
      return { kind: 'text', text };
    }
  }
}
