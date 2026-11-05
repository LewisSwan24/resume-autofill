import dayjs from 'dayjs';
import type { FormInstance, UploadFile } from 'antd';
import { installFixtureState, type FixtureState } from '../shared/state';

// How a form value is normalised into the fixture contract.
type Kind = 'text' | 'bool' | 'list' | 'date' | 'month' | 'files' | 'monthRange';

const FLAT: Array<[string, Kind]> = [
  ['name', 'text'],
  ['gender', 'text'],
  ['birthDate', 'date'],
  ['ethnicity', 'text'],
  ['politicalStatus', 'text'],
  ['phoneCountryCode', 'text'],
  ['phone', 'text'],
  ['email', 'text'],
  ['idNumber', 'text'],
  ['wechat', 'text'],
  ['qq', 'text'],
  ['nativePlace', 'list'],
  ['currentLocation', 'list'],
  ['expectedPosition', 'text'],
  ['expectedCities', 'list'],
  ['acceptAdjustment', 'text'],
];

const TAIL: Array<[string, Kind]> = [
  ['englishLevel', 'text'],
  ['foreignLanguage', 'text'],
  ['resume', 'files'],
  ['selfEvaluation', 'text'],
  ['referrerId', 'text'],
];

interface ListSpec {
  name: string;
  items: Array<[string, Kind]>;
}

const EDUCATION: ListSpec = {
  name: 'education',
  items: [
    ['school', 'text'],
    ['degree', 'text'],
    ['major', 'text'],
    ['startDate', 'month'],
    ['endDate', 'month'],
    ['gpa', 'text'],
    ['ranking', 'text'],
  ],
};
const INTERNSHIP: ListSpec = {
  name: 'internship',
  items: [
    ['company', 'text'],
    ['position', 'text'],
    ['startDate', 'month'],
    ['endDate', 'month'],
    ['current', 'bool'],
    ['description', 'text'],
  ],
};
const PROJECT: ListSpec = {
  name: 'project',
  items: [
    ['name', 'text'],
    ['period', 'monthRange'],
  ],
};
const AWARD: ListSpec = {
  name: 'award',
  items: [
    ['name', 'text'],
    ['date', 'month'],
    ['level', 'text'],
  ],
};

function normalise(kind: Kind, v: unknown): unknown {
  switch (kind) {
    case 'bool':
      return v === true;
    case 'list':
      return Array.isArray(v) ? v.map(String) : [];
    case 'files':
      return Array.isArray(v) ? (v as UploadFile[]).map((f) => f.name) : [];
    case 'monthRange':
      return Array.isArray(v) && v.every((d) => dayjs.isDayjs(d)) ? v.map((d) => dayjs(d as never).format('YYYY-MM')).join(' ~ ') : '';
    case 'date':
    case 'month':
      return dayjs.isDayjs(v) ? v.format(kind === 'date' ? 'YYYY-MM-DD' : 'YYYY-MM') : '';
    default:
      return v == null ? '' : String(v);
  }
}

function snapshot(form: FormInstance): FixtureState {
  const all = form.getFieldsValue(true) as Record<string, unknown>;
  const out: FixtureState = {};
  const flat = (specs: Array<[string, Kind]>) => {
    for (const [key, kind] of specs) out[key] = normalise(kind, all[key]);
  };
  const list = (spec: ListSpec) => {
    const rows = (all[spec.name] as Array<Record<string, unknown> | undefined> | undefined) ?? [];
    rows.forEach((row, i) => {
      for (const [key, kind] of spec.items) out[`${spec.name}[${i}].${key}`] = normalise(kind, row?.[key]);
    });
  };
  flat(FLAT);
  list(EDUCATION);
  list(INTERNSHIP);
  list(PROJECT);
  flat(TAIL.slice(0, 2));
  list(AWARD);
  flat(TAIL.slice(2));
  return out;
}

// The page installs __fixtureState immediately; it reports {} until the form has mounted.
let current: FormInstance | null = null;
installFixtureState(() => (current ? snapshot(current) : {}));

export function bindFixtureForm(form: FormInstance | null): void {
  current = form;
}
