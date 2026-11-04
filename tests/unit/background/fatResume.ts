// A resume with EVERY catalogued leaf set to a non-empty value (the samples leave many empty), so the
// "never leaks" property tests have something to leak.
import { ARRAY_MODULE_NAMES } from '../../../src/engine/fieldDeps';
import { ENUM_VALUES, FIELD_KEYS, ResumeSchema, type Locale, type Resume } from '../../../src/schema';

type Bag = Record<string, unknown>;

const ADDRESS: Record<string, string> = {
  addressCountry: 'country', addressProvince: 'province', addressCity: 'city', addressDistrict: 'district',
  addressStreet: 'street', postcode: 'postcode',
};

function valueFor(type: string, enumDomain: string | undefined, path: string, variant: number): unknown {
  switch (type) {
    case 'date':
      return `20${10 + variant}-0${1 + variant}`;
    case 'enum':
      return ENUM_VALUES[enumDomain!]![variant % ENUM_VALUES[enumDomain!]!.length];
    case 'bool':
      return true;
    case 'number':
      return 170 + variant;
    case 'list':
      return [`${path}-a`, `${path}-b`];
    case 'region':
      return { country: `${path}-co`, province: `${path}-pr`, city: `${path}-ci`, district: `${path}-di` };
    default:
      return `secret:${path}:${variant}`;
  }
}

export function resumeWithEverything(locale: Locale): Resume {
  const base = ResumeSchema.parse({ id: `fat-${locale}`, title: 'secret title', locale }) as Resume;
  const r = base as unknown as Bag;
  const ENTRIES = 3;
  for (const m of ARRAY_MODULE_NAMES) r[m] = Array.from({ length: ENTRIES }, () => ({}));
  r.customAnswers = [{ question: 'secret q', answer: 'secret a' }];
  r.linkedResumeId = 'secret-linked';

  for (const def of FIELD_KEYS) {
    if (def.derived) continue;
    const dot = def.key.indexOf('.');
    const module = def.key.slice(0, dot);
    const field = def.key.slice(dot + 1);
    if (module === 'misc') r[field] = valueFor(def.type, def.enumDomain, def.key, 0);
    else if (module === 'attachments') (r.attachments as Bag)[`${field}FileId`] = `file-${field}`;
    else if ((ARRAY_MODULE_NAMES as readonly string[]).includes(module)) {
      (r[module] as Bag[]).forEach((entry, i) => {
        entry[field] = valueFor(def.type, def.enumDomain, `${def.key}#${i}`, i);
      });
    } else if (module === 'contact' && field in ADDRESS) {
      ((r.contact as Bag).address as Bag)[ADDRESS[field]!] = `secret:${def.key}`;
    } else {
      (r[module] as Bag)[field] = valueFor(def.type, def.enumDomain, def.key, 0);
    }
  }
  return ResumeSchema.parse(r) as Resume;
}
