// Building the import: a new resume, or a merge that fills only what is empty unless told otherwise; and its undo.
import { describe, expect, it } from 'vitest';
import { addResume, createResume, getByPath, setActive, type ArrayModuleName } from '../../../../src/editor';
import type { TextLine } from '../../../../src/import/extract/types';
import type { DraftField } from '../../../../src/import/parse';
import { CURRENT_SCHEMA_VERSION, ProfileSchema, ResumeSchema, type Locale, type Profile, type Resume } from '../../../../src/schema';
import { buildImport, planMerge, undoImport } from '../../../../mobile/app/src/resumeImport/merge';
import { initReview, reviewReduce, type ReviewAction, type ReviewState } from '../../../../mobile/app/src/resumeImport/review';
import type { ImportFile, ReadSuccess } from '../../../../mobile/app/src/resumeImport/types';

const line = (text: string): TextLine => ({ text, cells: [text], page: 1, fontSize: 10 });
const field = (path: string, value: string, l = 0): DraftField => ({ path, value, line: l, certainty: 'check' });

const FIELDS: DraftField[] = [
  field('basics.familyName', '张'),
  field('basics.givenName', '三'),
  field('contact.email', 'zhangsan@example.com', 1),
  field('contact.phone', '13800138000', 1),
  field('contact.address.city', '北京', 2),
  field('education.0.school', '示例大学', 3),
  field('education.0.startDate', '2016-09', 3),
  field('education.0.endDate', '2020-06', 3),
  field('education.0.major', '计算机科学与技术', 4),
  field('education.1.school', '示例学院', 5),
  field('education.1.startDate', '2020-09', 5),
  field('work.0.company', '示例科技有限公司', 6),
  field('work.0.position', '前端工程师', 7),
  field('work.0.startDate', '2020-07', 6),
  field('work.0.current', 'true', 6),
  field('work.0.kind', 'full_time', 6),
  field('skills.0.name', 'TypeScript', 8),
  field('skills.1.name', 'React', 8),
];
const LINES = Array.from({ length: 9 }, (_, i) => line(`第 ${i} 行`));
const READ: ReadSuccess = { ok: true, kind: 'pdf', lines: LINES, draft: { locale: 'zh-CN', fields: FIELDS }, pages: 1, language: { locale: 'zh-CN', mixed: false } };
const FILE: ImportFile = { name: '张三的简历.pdf', mimeType: 'application/pdf', bytes: new Uint8Array(10), source: 'picker' };
const defaultTitle = (locale: Locale) => (locale === 'zh-CN' ? '我的中文简历' : 'My resume');
const NOW = 1_700_000_000_000;

/** The resume merged into: some of it filled, some of it the same, some of it different. */
function existing(): Resume {
  const r = createResume({ title: '我的中文简历', locale: 'zh-CN', id: 'r-old', now: 1 });
  return ResumeSchema.parse({
    ...r,
    basics: { ...r.basics, familyName: '李', givenName: ' 三 ' },
    contact: { ...r.contact, email: 'ZhangSan@Example.com', phone: '13900000000' },
    education: [{ school: '示例大学', startDate: '2016-09' }],
    work: [{ company: '另一家示例公司', position: '实习生', startDate: '2019-01', endDate: '2019-06', kind: 'internship' }],
    jobIntention: { positions: ['前端工程师'], cities: ['北京'] },
    attachments: { photoFileId: 'f-photo' },
  });
}
function profileWith(...resumes: Resume[]): Profile {
  let p = ProfileSchema.parse({ schemaVersion: CURRENT_SCHEMA_VERSION });
  for (const r of resumes) p = addResume(p, r);
  return resumes[0] ? setActive(p, resumes[0].id) : p;
}
const other = (): Resume => createResume({ title: 'Other', locale: 'en-AU', id: 'r-other', now: 2 });

function mergeState(profile: Profile, ...actions: ReviewAction[]): ReviewState {
  const s = initReview(READ, FILE, profile, defaultTitle);
  return [{ type: 'target', target: { kind: 'merge', resumeId: 'r-old' } } as ReviewAction, ...actions].reduce(reviewReduce, s);
}
const build = (state: ReviewState, profile: Profile, attachmentId: string | null = null) =>
  buildImport(state, profile, { newId: () => 'r-new', now: NOW, attachmentId, defaultTitle });

const merged = (state: ReviewState, profile: Profile): Resume => {
  const result = build(state, profile);
  if (!result.ok) throw new Error(`not built: ${result.problem ?? result.refused.join(',')}`);
  return result.profile.resumes.find((r) => r.id === result.resumeId)!;
};

const isEmpty = (v: unknown): boolean => v === undefined || v === null || v === '' || v === false || (Array.isArray(v) && v.length === 0);
/** Every leaf whose value changed to something filled, by path. */
function changedLeaves(before: unknown, after: unknown, prefix = ''): string[] {
  if (after && typeof after === 'object') {
    return Object.keys(after as object).flatMap((k) =>
      changedLeaves((before as Record<string, unknown> | undefined)?.[k], (after as Record<string, unknown>)[k], prefix ? `${prefix}.${k}` : k),
    );
  }
  return !isEmpty(after) && after !== before ? [prefix] : [];
}

describe('merge plan and merge', () => {
  it('merge fills only empty fields by default and keeps differing ones', () => {
    const profile = profileWith(existing(), other());
    const state = mergeState(profile);
    const plan = planMerge(state, existing());
    const byPath = new Map(plan.changes.map((c) => [c.path, c]));
    expect(byPath.get('basics.familyName')).toEqual({ path: 'basics.familyName', target: 'basics.familyName', kind: 'conflict', incoming: '张', existing: '李' });
    expect(byPath.get('contact.address.city')).toMatchObject({ kind: 'fill', existing: '' });
    const r = merged(state, profile);
    expect(r.basics.familyName).toBe('李');
    expect(r.contact.phone).toBe('13900000000');
    expect(r.contact.address.city).toBe('北京');
    expect(r.updatedAt).toBe(NOW);
  });

  it('chosen overwrites replace only those fields', () => {
    const profile = profileWith(existing(), other());
    const state = mergeState(profile, { type: 'overwrite', path: 'basics.familyName', on: true });
    const plan = planMerge(state, existing());
    expect(plan.counts.overwrite).toBe(1);
    const r = merged(state, profile);
    expect(r.basics.familyName).toBe('张');
    expect(r.contact.phone).toBe('13900000000');
  });

  it('equal values count as same and change nothing', () => {
    const profile = profileWith(existing(), other());
    const plan = planMerge(mergeState(profile), existing());
    const kinds = Object.fromEntries(plan.changes.map((c) => [c.path, c.kind]));
    expect(kinds['basics.givenName']).toBe('same');
    expect(kinds['contact.email']).toBe('same');
    expect(kinds['education.0.school']).toBe('same');
    expect(kinds['education.0.startDate']).toBe('same');
    const r = merged(mergeState(profile), profile);
    expect(r.basics.givenName).toBe(' 三 ');
    expect(r.contact.email).toBe('ZhangSan@Example.com');
  });

  it('an entry with the same school merges into it; one without a match is appended', () => {
    const profile = profileWith(existing(), other());
    const plan = planMerge(mergeState(profile), existing());
    expect(plan.entries).toEqual([
      { key: 'education.0', module: 'education', matchIndex: 0, matchLabel: '示例大学' },
      { key: 'education.1', module: 'education', matchIndex: null, matchLabel: '' },
      { key: 'work.0', module: 'work', matchIndex: null, matchLabel: '' },
      { key: 'skills.0', module: 'skills', matchIndex: null, matchLabel: '' },
      { key: 'skills.1', module: 'skills', matchIndex: null, matchLabel: '' },
    ]);
    expect(plan.changes.find((c) => c.path === 'education.0.major')).toMatchObject({ target: 'education.0.major', kind: 'fill' });
    expect(plan.counts.added).toBe(4);
    const r = merged(mergeState(profile), profile);
    expect(r.education.map((e) => e.school)).toEqual(['示例大学', '示例学院']);
    expect(r.education[0]!.major).toBe('计算机科学与技术');
    expect(r.education[0]!.endDate).toBe('2020-06');
    // The appended job keeps its hidden fields: it is current.
    expect(r.work.map((w) => w.company)).toEqual(['另一家示例公司', '示例科技有限公司']);
    expect(r.work[1]).toMatchObject({ current: true, endDate: null, kind: 'full_time' });
    expect(r.skills.map((s) => s.name)).toEqual(['TypeScript', 'React']);

    // The same school with a different start is another time there, so it is appended.
    const later = ResumeSchema.parse({ ...existing(), education: [{ school: '示例大学', startDate: '2012-09' }] });
    expect(planMerge(mergeState(profileWith(later)), later).entries[0]!.matchIndex).toBeNull();
  });

  it('dropped entries and skipped fields are never written', () => {
    const profile = profileWith(existing(), other());
    const state = mergeState(profile, { type: 'dropEntry', key: 'education.1' }, { type: 'keep', path: 'contact.address.city', keep: false }, { type: 'dropEntry', key: 'work.0' });
    const plan = planMerge(state, existing());
    expect(plan.changes.some((c) => c.path === 'contact.address.city')).toBe(false);
    expect(plan.entries.map((e) => e.key)).toEqual(['education.0', 'skills.0', 'skills.1']);
    const r = merged(state, profile);
    expect(r.contact.address.city ?? '').toBe('');
    expect(r.education.map((e) => e.school)).toEqual(['示例大学']);
    expect(r.work.map((w) => w.company)).toEqual(['另一家示例公司']);
  });

  it("the plan's counts equal what buildImport changes", () => {
    const profile = profileWith(existing(), other());
    for (const state of [
      mergeState(profile),
      mergeState(profile, { type: 'overwrite', path: 'basics.familyName', on: true }, { type: 'overwrite', path: 'contact.phone', on: true }),
      mergeState(profile, { type: 'dropEntry', key: 'education.0' }, { type: 'keep', path: 'contact.email', keep: false }),
    ]) {
      const plan = planMerge(state, existing());
      const after = merged(state, profile);
      const { updatedAt: _u, ...beforeRest } = existing();
      const { updatedAt: _v, ...afterRest } = after;
      const leaves = changedLeaves(beforeRest, afterRest).filter((p) => !/\.(?:current|kind)$/.test(p));
      expect(leaves.length).toBe(plan.willWrite);
      expect(plan.willWrite).toBe(plan.counts.fill + plan.counts.overwrite + leaves.filter((p) => /^(education\.1|work\.1|skills\.\d)\./.test(p)).length);
      const conflicts = plan.changes.filter((c) => c.kind === 'conflict').length;
      expect(plan.counts.overwrite + plan.counts.keepExisting).toBe(conflicts);
      expect(plan.counts.same).toBe(plan.changes.filter((c) => c.kind === 'same').length);
      // Written values are the incoming ones.
      for (const c of plan.changes.filter((x) => x.kind === 'fill' || state.overwrite.includes(x.path))) {
        expect(String(getByPath(after, c.target))).toBe(c.incoming);
      }
    }
  });

  it('merge keeps the target\'s id, title, locale and untouched modules', () => {
    const profile = profileWith(existing(), other());
    const before = existing();
    const r = merged(mergeState(profile), profile);
    expect(r.id).toBe(before.id);
    expect(r.title).toBe(before.title);
    expect(r.locale).toBe(before.locale);
    expect(r.createdAt).toBe(before.createdAt);
    expect(r.jobIntention).toEqual(before.jobIntention);
    expect(r.attachments).toEqual(before.attachments);
    expect(r.workRights).toEqual(before.workRights);
    // The other resume is untouched, and the merged one is active.
    const result = build(mergeState(profile), profile);
    expect(result.ok && result.profile.resumes.find((x) => x.id === 'r-other')).toEqual(other());
    expect(result.ok && result.profile.activeResumeId).toBe('r-old');
    expect(result.ok && result.before).toEqual(before);
    // With an attachment id, it becomes the resume PDF.
    const withFile = build(mergeState(profile), profile, 'f-new');
    expect(withFile.ok && withFile.profile.resumes.find((x) => x.id === 'r-old')!.attachments).toEqual({ photoFileId: 'f-photo', resumeFileId: 'f-new' });
  });

  it('an invalid value left on screen in another resume does not stop an import', () => {
    // The editor keeps a malformed value in the profile it shows and saves a repaired copy.
    const broken = { ...other(), basics: { ...other().basics, birthDate: '昨天' } } as Resume;
    const profile = { ...profileWith(existing(), other()), resumes: [existing(), broken] } as Profile;
    expect(ProfileSchema.safeParse(profile).success).toBe(false);
    const asMerge = build(mergeState(profile), profile);
    expect(asMerge.ok).toBe(true);
    const asNew = build(initReview(READ, FILE, profile, defaultTitle), profile);
    expect(asNew.ok).toBe(true);
    // The other resume is passed on as it was.
    expect(asNew.ok && asNew.profile.resumes.find((r) => r.id === 'r-other')!.basics.birthDate).toBe('昨天');
  });

  it('merge into a resume deleted meanwhile reports target_gone', () => {
    const profile = profileWith(existing(), other());
    const state = mergeState(profile);
    expect(build(state, profileWith(other()))).toEqual({ ok: false, refused: [], problem: 'target_gone' });
  });
});

describe('new resume', () => {
  const newState = (...actions: ReviewAction[]) => actions.reduce(reviewReduce, initReview(READ, FILE, profileWith(existing()), defaultTitle));

  it('new resume: refused values come back by draft path and nothing is built', () => {
    const state = newState({ type: 'dropEntry', key: 'education.0' }, { type: 'edit', path: 'education.1.startDate', value: '去年秋天' }, { type: 'edit', path: 'work.0.startDate', value: '很久以前' });
    expect(state.target.kind).toBe('new');
    const result = build(state, profileWith(existing()));
    expect(result.ok).toBe(false);
    expect(!result.ok && [...result.refused].sort()).toEqual(['education.1.startDate', 'work.0.startDate']);
    // Skipping the refused ones lets it through.
    const fixed = [{ type: 'keep', path: 'education.1.startDate', keep: false } as const, { type: 'keep', path: 'work.0.startDate', keep: false } as const].reduce(reviewReduce, state);
    expect(build(fixed, profileWith(existing())).ok).toBe(true);
  });

  it('new resume: chosen locale, title, phone code, attachment id; becomes active', () => {
    const profile = profileWith(existing(), other());
    const state = newState({ type: 'target', target: { kind: 'new', locale: 'en-AU', title: '  Sam CV  ' } });
    const result = build(state, profile, 'f-pdf');
    if (!result.ok) throw new Error('not built');
    expect(result.resumeId).toBe('r-new');
    expect(result.before).toBeNull();
    expect(result.previousActiveId).toBe('r-old');
    expect(result.profile.activeResumeId).toBe('r-new');
    const r = result.profile.resumes.find((x) => x.id === 'r-new')!;
    expect(r).toMatchObject({ locale: 'en-AU', title: 'Sam CV', createdAt: NOW, updatedAt: NOW });
    expect(r.contact.phoneCountryCode).toBe('+61');
    expect(r.attachments.resumeFileId).toBe('f-pdf');
    expect(r.basics.familyName).toBe('张');
    expect(r.education.map((e) => e.school)).toEqual(['示例大学', '示例学院']);
    expect(result.profile.resumes).toHaveLength(3);
    // An empty title takes the default for the language.
    const untitled = build(newState({ type: 'target', target: { kind: 'new', locale: 'zh-CN', title: ' ' } }), profile);
    expect(untitled.ok && untitled.profile.resumes.find((x) => x.id === 'r-new')!.title).toBe('我的中文简历');
  });
});

describe('undoImport', () => {
  it('undoImport removes a new resume and restores the active one', () => {
    const profile = profileWith(existing(), other());
    const result = build(initReview(READ, FILE, profile, defaultTitle), profile);
    if (!result.ok) throw new Error('not built');
    const undone = undoImport(result.profile, result);
    expect(undone).toEqual(profile);
  });

  it('undoImport puts a merged resume back exactly', () => {
    const profile = setActive(profileWith(existing(), other()), 'r-other');
    const state = mergeState(profile, { type: 'overwrite', path: 'basics.familyName', on: true });
    const result = build(state, profile, 'f-new');
    if (!result.ok) throw new Error('not built');
    expect(result.profile.activeResumeId).toBe('r-old');
    expect(result.previousActiveId).toBe('r-other');
    expect(undoImport(result.profile, result)).toEqual(profile);
    // The active one was deleted meanwhile: the active resume stays where it is.
    const gone = { ...result, previousActiveId: 'nobody' };
    expect(undoImport(result.profile, gone).activeResumeId).toBe('r-old');
    const modules: ArrayModuleName[] = ['education', 'work', 'skills'];
    for (const m of modules) expect(undoImport(result.profile, result).resumes[0]![m]).toEqual(existing()[m]);
  });
});
