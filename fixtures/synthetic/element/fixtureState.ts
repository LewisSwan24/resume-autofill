import { installFixtureState, type FixtureState } from '../shared/state';

export interface UploadItem {
  name: string;
}

export interface EducationEntry {
  school: string;
  degree: string;
  academicDegree: string;
  major: string;
  startDate: string;
  endDate: string;
  // Remote-search state of the 学校 select (not part of the fixture contract).
  schoolOptions: string[];
  schoolLoading: boolean;
}
export interface InternshipEntry {
  company: string;
  position: string;
  startDate: string;
  endDate: string;
  current: boolean;
  description: string;
}
export interface ProjectEntry {
  name: string;
  role: string;
  description: string;
}
export interface FamilyRow {
  relationship: string;
  name: string;
  employer: string;
  position: string;
}

export interface FormModel {
  name: string;
  gender: string;
  birthMonth: string;
  politicalStatus: string;
  maritalStatus: string;
  phone: string;
  email: string;
  household: string[];
  studentOrigin: string[];
  education: EducationEntry[];
  internship: InternshipEntry[];
  project: ProjectEntry[];
  family: FamilyRow[];
  emergencyName: string;
  emergencyPhone: string;
  acceptRelocation: boolean;
  photo: UploadItem[];
  selfIntroduction: string;
}

const str = (v: unknown): string => (v == null ? '' : String(v));
const list = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : []);

/** Normalise the model into the fixture contract (flat keys, `array[i].field` for card lists). */
export function snapshot(m: FormModel): FixtureState {
  const out: FixtureState = {};
  out.name = str(m.name);
  out.gender = str(m.gender);
  out.birthMonth = str(m.birthMonth);
  out.politicalStatus = str(m.politicalStatus);
  out.maritalStatus = str(m.maritalStatus);
  out.phone = str(m.phone);
  out.email = str(m.email);
  out.household = list(m.household);
  out.studentOrigin = list(m.studentOrigin);
  m.education.forEach((r, i) => {
    for (const k of ['school', 'degree', 'academicDegree', 'major', 'startDate', 'endDate'] as const) {
      out[`education[${i}].${k}`] = str(r[k]);
    }
  });
  m.internship.forEach((r, i) => {
    for (const k of ['company', 'position', 'startDate', 'endDate', 'description'] as const) {
      out[`internship[${i}].${k}`] = str(r[k]);
    }
    out[`internship[${i}].current`] = r.current === true;
  });
  m.project.forEach((r, i) => {
    for (const k of ['name', 'role', 'description'] as const) out[`project[${i}].${k}`] = str(r[k]);
  });
  m.family.forEach((r, i) => {
    for (const k of ['relationship', 'name', 'employer', 'position'] as const) out[`family[${i}].${k}`] = str(r[k]);
  });
  out['emergencyContact.name'] = str(m.emergencyName);
  out['emergencyContact.phone'] = str(m.emergencyPhone);
  out.acceptRelocation = m.acceptRelocation === true;
  out.photo = m.photo.map((f) => f.name);
  out.selfIntroduction = str(m.selfIntroduction);
  return out;
}

// The page installs __fixtureState immediately; it reports {} until the form has mounted.
let current: FormModel | null = null;
installFixtureState(() => (current ? snapshot(current) : {}));

export function bindFixtureModel(model: FormModel | null): void {
  current = model;
}
