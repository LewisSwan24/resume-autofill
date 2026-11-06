import { describe, expect, it } from 'vitest';
import { buildResumeSubset } from '../../../src/background/subset';
import {
  ALL_FIELD_KEYS,
  ARRAY_MODULE_NAMES,
  ATTACHMENT_KEYS,
  ATTACHMENT_PROP,
  ENTRY_ALIGNMENT_FIELDS,
  FIELD_DEPS,
  REPEAT_SECTIONS,
  emptyNeeds,
  expandFieldKeys,
  sectionModule,
  type AttachmentKey,
  type FrameNeeds,
} from '../../../src/engine/fieldDeps';
import { resolveValue } from '../../../src/engine/values';
import { ENUM_VALUES, FIELD_KEYS, ResumeSchema, createSampleProfile, type Resume, type SectionKey } from '../../../src/schema';
import { resumeWithEverything } from './fatResume';

const NOW = new Date(2026, 5, 15);
const samples = createSampleProfile().resumes;
const zh = samples.find((r) => r.id === 'sample-zh')!;
const en = samples.find((r) => r.id === 'sample-en')!;
const fat = resumeWithEverything('en-AU');
const fatZh = resumeWithEverything('zh-CN');
const RESUMES: Resume[] = [zh, en, fat, fatZh];

const needs = (p: Partial<FrameNeeds>): FrameNeeds => ({ ...emptyNeeds(), ...p });

describe('a city picked from a list', () => {
  it('goes with the country and state that tell places of one name apart, and no more of the address', () => {
    const out = buildResumeSubset(en, needs({ fieldKeys: ['contact.addressCity'] }));
    expect(out.contact.address).toMatchObject({
      city: en.contact.address.city,
      country: en.contact.address.country,
      province: en.contact.address.province,
    });
    expect(out.contact.address.street).toBe('');
    expect(out.contact.address.postcode).toBe('');
  });
});

describe('a state picked from a list', () => {
  it('goes with its country, which decides how a short form reads', () => {
    const out = buildResumeSubset(en, needs({ fieldKeys: ['contact.addressProvince'] }));
    expect(out.contact.address).toMatchObject({ province: en.contact.address.province, country: en.contact.address.country, city: '' });
  });
});

describe('a phone code picked from a list', () => {
  it('goes with the country, which settles a code several places share', () => {
    const out = buildResumeSubset(en, needs({ fieldKeys: ['contact.phoneCountryCode'] }));
    expect(out.contact.phoneCountryCode).toBe(en.contact.phoneCountryCode);
    expect(out.contact.address.country).toBe(en.contact.address.country);
    expect(out.contact.address.street).toBe('');
  });
});

describe('the choice of how to answer a gender question', () => {
  const chosen = { ...en, diversity: { ...en.diversity, genderAnswer: 'from_resume' as const } };

  it('goes along with the gender', () => {
    const out = buildResumeSubset(chosen, needs({ fieldKeys: ['basics.gender'] }));
    expect(out.basics.gender).toBe(en.basics.gender);
    expect(out.diversity.genderAnswer).toBe('from_resume');
  });

  it('stays home otherwise', () => {
    const out = buildResumeSubset(chosen, needs({ fieldKeys: ['contact.email'] }));
    expect(out.diversity.genderAnswer).toBe('prefer_not_to_say');
  });
});

// ---------------------------------------------------------------- leaf walking

type Leaf = [path: string, value: unknown];

/** Every leaf of the resume as `path → value`; entries of arrays are `module[i].field`; `{}` / `[]` are leaves. */
function leaves(value: unknown, path = ''): Leaf[] {
  if (Array.isArray(value)) {
    if (value.length === 0 || value.every((v) => typeof v !== 'object' || v === null)) return [[path, value]];
    return value.flatMap((v, i) => leaves(v, `${path}[${i}]`));
  }
  if (/^basics\.(nativePlace|studentOrigin|household|currentLocation)$/.test(path)) return [[path, value]];
  if (typeof value === 'object' && value !== null) {
    const entries = Object.entries(value);
    return entries.flatMap(([k, v]) => leaves(v, path ? `${path}.${k}` : k));
  }
  return [[path, value]];
}

const isBlank = (v: unknown): boolean =>
  v === '' || v === null || v === undefined || v === false || (Array.isArray(v) && v.length === 0) ||
  (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.values(v).every(isBlank));

/** Fields the subset may carry although nothing asked for them: non-nullable enum defaults / identity. */
const NEVER_BLANK = /^(id|locale|diversity\.\w+|createdAt|updatedAt)$/;

// ---------------------------------------------------------------- independent oracle: what needs imply

const ADDRESS_PATH: Record<string, string> = {
  addressCountry: 'contact.address.country',
  addressProvince: 'contact.address.province',
  addressCity: 'contact.address.city',
  addressDistrict: 'contact.address.district',
  addressStreet: 'contact.address.street',
  postcode: 'contact.address.postcode',
};

/** Resume leaf paths (without entry index) whose value may legitimately be in a subset for these needs. */
function impliedPaths(n: FrameNeeds): { single: Set<string>; arrayLeaf: Set<string>; wholeModules: Set<string> } {
  const keys = expandFieldKeys(n.fieldKeys.filter((k) => !k.startsWith('attachments.')));
  const single = new Set<string>();
  const arrayLeaf = new Set<string>();
  for (const k of keys) {
    const [module, field] = [k.slice(0, k.indexOf('.')), k.slice(k.indexOf('.') + 1)];
    if (module === 'misc') single.add(field);
    else if ((ARRAY_MODULE_NAMES as readonly string[]).includes(module)) {
      arrayLeaf.add(`${module}.${field}`);
      for (const a of ENTRY_ALIGNMENT_FIELDS[module as keyof typeof ENTRY_ALIGNMENT_FIELDS] ?? []) arrayLeaf.add(`${module}.${a}`);
    } else if (module === 'contact' && field in ADDRESS_PATH) single.add(ADDRESS_PATH[field]!);
    else single.add(k);
  }
  const attachments = [...n.attachmentKeys, ...n.fieldKeys.filter((k): k is AttachmentKey => k.startsWith('attachments.'))];
  for (const a of attachments) single.add(`attachments.${ATTACHMENT_PROP[a]}`);
  const wholeModules = new Set<string>();
  for (const s of n.repeatSections) {
    const m = sectionModule(s);
    if (m) wholeModules.add(m);
  }
  return { single, arrayLeaf, wholeModules };
}

function assertNoLeak(resume: Resume, n: FrameNeeds): void {
  const subset = buildResumeSubset(resume, n);
  const baseline = buildResumeSubset(resume, emptyNeeds());
  const implied = impliedPaths(n);
  const baseLeaves = new Map(leaves(baseline));
  for (const [path, value] of leaves(subset)) {
    if (NEVER_BLANK.test(path)) continue;
    if (JSON.stringify(value) === JSON.stringify(baseLeaves.get(path))) continue; // same as the empty skeleton
    if (isBlank(value)) continue;
    const m = /^(\w+)\[\d+\]\.(\w+)$/.exec(path);
    const ok = m
      ? implied.wholeModules.has(m[1]!) || implied.arrayLeaf.has(`${m[1]}.${m[2]}`)
      : implied.single.has(path);
    expect(ok, `leaf ${path}=${JSON.stringify(value)} is not implied by ${JSON.stringify(n)}`).toBe(true);
  }
}

// ---------------------------------------------------------------- tests

describe('buildResumeSubset: shape', () => {
  it('the empty needs give a schema-valid, blank resume that keeps only id and locale', () => {
    for (const r of RESUMES) {
      const s = buildResumeSubset(r, emptyNeeds());
      expect(ResumeSchema.safeParse(s).success).toBe(true);
      expect(s.id).toBe(r.id);
      expect(s.locale).toBe(r.locale);
      expect(s.title).toBe('');
      expect(s.linkedResumeId).toBeUndefined();
      expect(s.customAnswers).toEqual([]);
      for (const [path, v] of leaves(s)) if (!NEVER_BLANK.test(path)) expect(isBlank(v), path).toBe(true);
      for (const m of ARRAY_MODULE_NAMES) expect(s[m]).toEqual([]);
      expect(s.attachments).toEqual({});
      expect(s.contact.phoneCountryCode).toBe('');
    }
  });

  it('does not alias the source (editing the subset never touches the resume)', () => {
    const copy = structuredClone(zh);
    const s = buildResumeSubset(zh, needs({ fieldKeys: ['basics.nativePlace', 'jobIntention.positions'], repeatSections: ['education'] }));
    s.basics.nativePlace.city = 'X';
    s.jobIntention.positions.push('X');
    s.education[0]!.school = 'X';
    expect(zh).toEqual(copy);
  });
});

describe('buildResumeSubset: single modules (per leaf)', () => {
  it('(b) a frame needing only contact.email gets that leaf and nothing else', () => {
    const s = buildResumeSubset(zh, needs({ fieldKeys: ['contact.email'] }));
    expect(s.contact.email).toBe(zh.contact.email);
    expect(JSON.stringify(s)).not.toContain(zh.contact.phone);
    expect(JSON.stringify(s)).not.toContain(zh.basics.idNumber);
    expect(JSON.stringify(s)).not.toContain(zh.selfIntroduction);
    expect({ ...s, contact: { ...s.contact, email: '' } }).toEqual(buildResumeSubset(zh, emptyNeeds()));
    expect(s.attachments).toEqual({});
  });

  it('never carries an identity number, not even to a page that asks for one', () => {
    const s = buildResumeSubset(zh, needs({ fieldKeys: ['basics.idNumber', 'basics.idType', 'basics.fullName'] }));
    expect(s.basics.idNumber).toBe('');
    expect(JSON.stringify(s)).not.toContain(zh.basics.idNumber);
    expect(s.basics.familyName).toBe(zh.basics.familyName);
  });

  it('copies address parts by key and misc strings', () => {
    const s = buildResumeSubset(en, needs({ fieldKeys: ['contact.addressCity', 'contact.postcode', 'misc.selfIntroduction'] }));
    expect(s.contact.address).toEqual({ country: 'Australia', province: 'ACT', city: 'Canberra', district: '', street: '', postcode: '2600' });
    expect(s.selfIntroduction).toBe(en.selfIntroduction);
    expect(s.hobbies).toBe('');
  });

  it('ignores unknown keys', () => {
    const s = buildResumeSubset(zh, needs({ fieldKeys: ['nope.nothing', 'basics.nothing', 'noDot'] }));
    expect(s).toEqual(buildResumeSubset(zh, emptyNeeds()));
  });
});

describe('buildResumeSubset: derived keys pull their sources', () => {
  const derivedCases: [key: string, resume: Resume, sources: string[]][] = [
    ['basics.fullName', zh, ['basics.familyName', 'basics.givenName']],
    ['basics.fullName', en, ['basics.familyName', 'basics.givenName']],
    ['basics.age', zh, ['basics.birthDate']],
    ['contact.phoneFull', en, ['contact.phone', 'contact.phoneCountryCode']],
    ['contact.addressFull', en, ['contact.address.country', 'contact.address.province', 'contact.address.city',
      'contact.address.district', 'contact.address.street', 'contact.address.postcode']],
    // needs are locale-agnostic: a zh resume gets the same six parts although it writes only four of them
    ['contact.addressFull', fatZh, ['contact.address.country', 'contact.address.province', 'contact.address.city',
      'contact.address.district', 'contact.address.street', 'contact.address.postcode']],
  ];

  it.each(derivedCases)('(d) %s (%s) gets exactly its source leaves', (key, resume, sources) => {
    const s = buildResumeSubset(resume, needs({ fieldKeys: [key] }));
    const baseline = new Map(leaves(buildResumeSubset(resume, emptyNeeds())));
    const full = new Map(leaves(resume));
    const changed = leaves(s).filter(([p, v]) => !NEVER_BLANK.test(p) && JSON.stringify(v) !== JSON.stringify(baseline.get(p)));
    expect(changed.map(([p]) => p).sort()).toEqual(sources.filter((p) => !isBlank(full.get(p))).sort());
    for (const [p, v] of changed) expect(v).toEqual(full.get(p));
  });

  it('(d) every dependency-table entry is sufficient: the derived value is identical to the full resume', () => {
    for (const r of RESUMES) {
      for (const key of Object.keys(FIELD_DEPS)) {
        const s = buildResumeSubset(r, needs({ fieldKeys: [key] }));
        const sections: (SectionKey | null)[] = key.startsWith('work.') ? ['work', 'internship'] : [key.split('.')[0] as SectionKey];
        for (const section of sections) {
          for (let i = 0; i < 3; i++) {
            expect(resolveValue(key, s, i, section, { now: NOW }), `${r.id} ${key} #${i}`).toEqual(
              resolveValue(key, r, i, section, { now: NOW }),
            );
          }
        }
      }
    }
  });

  it('(d) the derived values exist on the fully populated resume, so the check above is not vacuous', () => {
    for (const key of ['basics.fullName', 'basics.age', 'contact.phoneFull', 'contact.addressFull']) {
      expect(resolveValue(key, fat, 0, null, { now: NOW }), key).not.toBeNull();
    }
  });

  it('endDate pulls current (alignment of "until now" entries); unrelated leaves stay blank', () => {
    const s = buildResumeSubset(zh, needs({ fieldKeys: ['work.endDate'] }));
    expect(s.work.map((w) => w.current)).toEqual(zh.work.map((w) => w.current));
    expect(s.work.map((w) => w.endDate)).toEqual(zh.work.map((w) => w.endDate));
    expect(s.work.every((w) => w.company === '' && w.description === '')).toBe(true);
    // the current entry has no end date, exactly as with the full resume
    for (let i = 0; i < zh.work.length; i++) {
      expect(resolveValue('work.endDate', s, i, 'internship')).toEqual(resolveValue('work.endDate', zh, i, 'internship'));
    }
  });
});

describe('buildResumeSubset: repeated modules', () => {
  it('(e) preserves the entry count of requested modules (sections and keys alike), others are empty', () => {
    const s = buildResumeSubset(zh, needs({ fieldKeys: ['education.school', 'skills.name'], repeatSections: ['education', 'internship'] }));
    expect(s.education).toHaveLength(zh.education.length);
    expect(s.work).toHaveLength(zh.work.length); // internship section → the work module
    expect(s.skills).toHaveLength(zh.skills.length); // reached by key only
    expect(s.family).toHaveLength(0);
    expect(s.projects).toHaveLength(0);
    expect(s.referees).toHaveLength(0);
  });

  it('(e) a repeated section includes every leaf of its entries (module granularity)', () => {
    const s = buildResumeSubset(zh, needs({ repeatSections: ['education'] }));
    expect(s.education).toEqual(zh.education);
    expect(s.work).toEqual([]);
  });

  it('(e) a module reached only by key keeps all entries but just the requested + alignment leaves', () => {
    const s = buildResumeSubset(zh, needs({ fieldKeys: ['work.company'] }));
    expect(s.work).toHaveLength(zh.work.length);
    expect(s.work.map((w) => w.company)).toEqual(zh.work.map((w) => w.company));
    expect(s.work.map((w) => w.kind)).toEqual(zh.work.map((w) => w.kind)); // alignment leaf
    expect(s.work.every((w) => w.position === '' && w.description === '' && w.startDate === '')).toBe(true);
    // internship/work split of the page section works exactly as with the full resume
    for (const section of ['work', 'internship'] as const) {
      for (const hasInternshipSection of [false, true]) {
        for (let i = 0; i < 3; i++) {
          expect(resolveValue('work.company', s, i, section, { hasInternshipSection })).toEqual(
            resolveValue('work.company', zh, i, section, { hasInternshipSection }),
          );
        }
      }
    }
  });

  it('card alignment sees the same entry counts as with the full resume', () => {
    for (const r of RESUMES) {
      for (const section of REPEAT_SECTIONS) {
        const s = buildResumeSubset(r, needs({ fieldKeys: ALL_FIELD_KEYS.filter((k) => k !== 'attachments.resume'), repeatSections: [section] }));
        const m = sectionModule(section)!;
        expect(s[m]).toHaveLength(r[m].length);
      }
    }
  });
});

describe('buildResumeSubset: attachments', () => {
  it('(c) carries only the file ids of the requested attachment keys', () => {
    const r = { ...zh, attachments: { resumeFileId: 'f-resume', photoFileId: 'f-photo', transcriptFileId: 'f-tr' } };
    expect(buildResumeSubset(r, needs({ attachmentKeys: ['attachments.resume'] })).attachments).toEqual({ resumeFileId: 'f-resume' });
    expect(buildResumeSubset(r, needs({ attachmentKeys: ['attachments.photo', 'attachments.transcript'] })).attachments).toEqual({
      photoFileId: 'f-photo',
      transcriptFileId: 'f-tr',
    });
    expect(buildResumeSubset(r, needs({ fieldKeys: ['contact.email'] })).attachments).toEqual({});
  });

  it('a missing file id stays missing', () => {
    expect(buildResumeSubset(en, needs({ attachmentKeys: ['attachments.photo'] })).attachments).toEqual({});
  });
});

describe('buildResumeSubset: functional equivalence (what a frame asks for resolves exactly as in the full resume)', () => {
  it('every requested key resolves identically for every entry index and section', () => {
    for (const r of RESUMES) {
      for (const def of FIELD_KEYS) {
        if (def.type === 'file') continue;
        const s = buildResumeSubset(r, needs({ fieldKeys: [def.key] }));
        const module = def.key.slice(0, def.key.indexOf('.'));
        const sections: (SectionKey | null)[] = def.sections.length > 0 ? def.sections : [null];
        for (const section of sections) {
          for (let i = 0; i < 4; i++) {
            for (const hasInternshipSection of [false, true]) {
              const opts = { hasInternshipSection, now: NOW };
              expect(resolveValue(def.key, s, i, section, opts), `${r.id} ${def.key} #${i} in ${section} (${module})`).toEqual(
                resolveValue(def.key, r, i, section, opts),
              );
            }
          }
        }
      }
    }
  });
});

describe('buildResumeSubset: never leaks a value the needs do not imply (property style)', () => {
  /** Small deterministic PRNG (mulberry32). */
  function rng(seed: number): () => number {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const pick = <T>(rand: () => number, list: readonly T[], p: number): T[] => list.filter(() => rand() < p);

  it('single-key needs: each catalogued key on every resume', () => {
    for (const r of RESUMES) {
      for (const key of ALL_FIELD_KEYS) assertNoLeak(r, needs({ fieldKeys: [key] }));
      for (const section of REPEAT_SECTIONS) assertNoLeak(r, needs({ repeatSections: [section] }));
      for (const a of ATTACHMENT_KEYS) assertNoLeak(r, needs({ attachmentKeys: [a] }));
    }
  });

  it('500 random need sets over the sample and the fully populated resumes', () => {
    const rand = rng(20261104);
    for (let i = 0; i < 500; i++) {
      const n: FrameNeeds = {
        fieldKeys: pick(rand, ALL_FIELD_KEYS.filter((k) => !k.startsWith('attachments.')), rand() * 0.3),
        repeatSections: pick(rand, REPEAT_SECTIONS, rand() * 0.4),
        attachmentKeys: pick<AttachmentKey>(rand, ATTACHMENT_KEYS, 0.3),
      };
      assertNoLeak(RESUMES[i % RESUMES.length]!, n);
    }
  });

  it('the fully populated resume has a non-blank value behind every catalogued key (the property tests are not vacuous)', () => {
    const full = new Map(leaves(fat));
    for (const def of FIELD_KEYS) {
      if (def.derived) continue;
      const [module, field] = [def.key.slice(0, def.key.indexOf('.')), def.key.slice(def.key.indexOf('.') + 1)];
      const path = module === 'misc' ? field
        : module === 'attachments' ? `attachments.${field}FileId`
        : (ARRAY_MODULE_NAMES as readonly string[]).includes(module) ? `${module}[0].${field}`
        : module === 'contact' && field.startsWith('address') ? `contact.address.${field.slice(7).toLowerCase()}`
        : module === 'contact' && field === 'postcode' ? 'contact.address.postcode'
        : def.key;
      expect(isBlank(full.get(path)) && def.type !== 'bool', path).toBe(false);
    }
  });
  it('enum domains used by the fat resume are real codes', () => {
    expect(ENUM_VALUES.gender).toContain(fat.basics.gender);
  });
});
