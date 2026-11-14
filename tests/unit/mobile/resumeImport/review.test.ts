// The review of what was read: defaults, edits, keep and drop, grouping, the summary and the draft built from it.
import { describe, expect, it } from 'vitest';
import { addResume, createResume, setAttachment, updateResume } from '../../../../src/editor';
import type { TextLine } from '../../../../src/import/extract/types';
import type { DraftField } from '../../../../src/import/parse';
import { CURRENT_SCHEMA_VERSION, ProfileSchema, type Locale, type Profile } from '../../../../src/schema';
import { groupsOf, initReview, isDirty, reviewReduce, summaryOf, toDraft, type ReviewAction, type ReviewState } from '../../../../mobile/app/src/resumeImport/review';
import type { ImportFile, ReadSuccess } from '../../../../mobile/app/src/resumeImport/types';

const line = (text: string): TextLine => ({ text, cells: [text], page: 1, fontSize: 10 });
const field = (path: string, value: string, line: number, certainty: 'high' | 'check' = 'high'): DraftField => ({ path, value, line, certainty });

const LINES = ['张三', '电话：13800138000 邮箱：zhangsan@example.com', '教育经历', '示例大学 2016.09 - 2020.06', '示例学院 2020.09 - 2023.06', '工作经历', '示例科技有限公司 2020.07 - 至今', '前端工程师'].map(line);

const FIELDS: DraftField[] = [
  field('contact.email', 'zhangsan@example.com', 1),
  field('contact.phone', '13800138000', 1),
  field('basics.familyName', '张', 0, 'check'),
  field('basics.givenName', '三', 0, 'check'),
  field('education.0.school', '示例大学', 3, 'check'),
  field('education.0.startDate', '2016-09', 3),
  field('education.0.current', 'false', 3),
  field('education.1.school', '示例学院', 4, 'check'),
  field('education.1.startDate', '2020-09', 4),
  field('work.0.company', '示例科技有限公司', 6, 'check'),
  field('work.0.startDate', '2020-07', 6),
  field('work.0.current', 'true', 6),
  field('work.0.kind', 'full_time', 6),
  field('work.0.position', '前端工程师', 7, 'check'),
  // Read-time names the editor has no field for are left out of the review.
  field('location', '北京', 2),
];

const READ: ReadSuccess = {
  ok: true,
  kind: 'pdf',
  lines: LINES,
  draft: { locale: 'zh-CN', fields: FIELDS },
  pages: 1,
  language: { locale: 'zh-CN', mixed: false },
};

const fileOf = (over: Partial<ImportFile> = {}): ImportFile => ({ name: '张三的简历.pdf', mimeType: 'application/pdf', bytes: new Uint8Array(1234), source: 'picker', ...over });
const defaultTitle = (locale: Locale) => (locale === 'zh-CN' ? '我的中文简历' : 'My resume');
const emptyProfile = (): Profile => ProfileSchema.parse({ schemaVersion: CURRENT_SCHEMA_VERSION });

/** A profile whose active resume has a name in it, so it is not blank. */
function filledProfile(): Profile {
  const r = createResume({ title: '现有简历', locale: 'zh-CN', id: 'r-filled', now: 1 });
  return addResume(emptyProfile(), { ...r, basics: { ...r.basics, familyName: '李' } }, { activate: true });
}
function blankProfile(): Profile {
  const r = createResume({ title: '空白简历', locale: 'en-AU', id: 'r-blank', now: 1 });
  return addResume(emptyProfile(), r, { activate: true });
}

const start = (over: Partial<ImportFile> = {}, profile: Profile | null = filledProfile(), read: ReadSuccess = READ): ReviewState =>
  initReview(read, fileOf(over), profile, defaultTitle);
const run = (state: ReviewState, ...actions: ReviewAction[]): ReviewState => actions.reduce(reviewReduce, state);

describe('initReview', () => {
  it('initReview keeps every known field, groups in editor order, and hides current and kind', () => {
    const s = start();
    expect(s.items.map((i) => i.path)).toEqual(FIELDS.filter((f) => f.path !== 'location').map((f) => f.path));
    expect(s.items.every((i) => i.keep && i.value === i.read)).toBe(true);
    expect(s.items.filter((i) => i.hidden).map((i) => i.path)).toEqual(['education.0.current', 'work.0.current', 'work.0.kind']);
    expect(s.file).toEqual({ name: '张三的简历.pdf', kind: 'pdf', source: 'picker', size: 1234, pages: 1 });
    expect(s.lines).toBe(LINES);
    expect(s).toMatchObject({ dropped: [], overwrite: [], onlyCheck: false, language: { locale: 'zh-CN', mixed: false } });

    const groups = groupsOf(s);
    expect(groups.map((g) => g.key)).toEqual(['basics', 'contact', 'education.0', 'education.1', 'work.0']);
    expect(groups.find((g) => g.key === 'work.0')!.items.map((i) => i.path)).toEqual(['work.0.company', 'work.0.position', 'work.0.startDate']);
    expect(groups.find((g) => g.key === 'education.1')).toMatchObject({ module: 'education', entry: 1, dropped: false });
    expect(groups.find((g) => g.key === 'basics')!.entry).toBeNull();
  });
});

describe('summary and edits', () => {
  it('summary counts recognised and to-check items; a skipped item leaves willWrite', () => {
    const s = start();
    expect(summaryOf(s)).toEqual({ recognised: 11, toCheck: 6, willWrite: 11 });
    const skipped = run(s, { type: 'keep', path: 'basics.familyName', keep: false });
    expect(summaryOf(skipped)).toEqual({ recognised: 11, toCheck: 5, willWrite: 10 });
    // An emptied value writes nothing either.
    expect(summaryOf(run(s, { type: 'edit', path: 'contact.phone', value: '  ' })).willWrite).toBe(10);
  });

  it('edit changes only that value and makes the review dirty', () => {
    const s = start();
    expect(isDirty(s)).toBe(false);
    const edited = run(s, { type: 'edit', path: 'education.0.school', value: '示例大学（本部）' });
    expect(edited.items.find((i) => i.path === 'education.0.school')).toMatchObject({ value: '示例大学（本部）', read: '示例大学' });
    expect(edited.items.filter((i) => i.value !== i.read)).toHaveLength(1);
    expect(isDirty(edited)).toBe(true);
    expect(isDirty(run(edited, { type: 'edit', path: 'education.0.school', value: '示例大学' }))).toBe(false);
    // Target and toggles alone do not make a review dirty.
    expect(isDirty(run(s, { type: 'onlyCheck', on: true }, { type: 'attachPdf', on: false }, { type: 'target', target: { kind: 'new', locale: 'en-AU', title: 'x' } }))).toBe(false);
  });

  it('keep off leaves the item out of toDraft; keep on brings it back with its edited value', () => {
    const s = run(start(), { type: 'edit', path: 'contact.email', value: 'san@example.com' }, { type: 'keep', path: 'contact.email', keep: false });
    expect(toDraft(s).draft.fields.some((f) => f.path === 'contact.email')).toBe(false);
    const back = run(s, { type: 'keep', path: 'contact.email', keep: true });
    expect(toDraft(back).draft.fields.find((f) => f.path === 'contact.email')).toEqual({ path: 'contact.email', value: 'san@example.com', certainty: 'high', line: 1 });
  });

  it('dropping an entry leaves out all its fields, hidden ones too, and renumbers later entries', () => {
    const s = run(start(), { type: 'dropEntry', key: 'education.0' });
    expect(s.dropped).toEqual(['education.0']);
    expect(isDirty(s)).toBe(true);
    expect(groupsOf(s).find((g) => g.key === 'education.0')!.dropped).toBe(true);
    expect(summaryOf(s).recognised).toBe(9);
    const { draft, pathMap } = toDraft(s);
    const paths = draft.fields.map((f) => f.path);
    expect(paths.filter((p) => p.startsWith('education.'))).toEqual(['education.0.school', 'education.0.startDate']);
    expect(draft.fields.find((f) => f.path === 'education.0.school')!.value).toBe('示例学院');
    expect(pathMap.get('education.1.school')).toBe('education.0.school');
    expect(pathMap.has('education.0.school')).toBe(false);
    expect(pathMap.has('education.0.current')).toBe(false);
    // Hidden fields of a kept entry go with it.
    expect(paths).toContain('work.0.current');
    expect(paths).toContain('work.0.kind');
    expect(pathMap.get('contact.email')).toBe('contact.email');
  });

  it('restoring an entry brings back its earlier edits', () => {
    const s = run(start(), { type: 'edit', path: 'education.0.school', value: '示例大学本部' }, { type: 'dropEntry', key: 'education.0' }, { type: 'restoreEntry', key: 'education.0' });
    expect(s.dropped).toEqual([]);
    expect(toDraft(s).draft.fields.find((f) => f.path === 'education.0.school')!.value).toBe('示例大学本部');
  });
});

describe('defaults', () => {
  it('default target: new, in the detected language, titled from the file name', () => {
    expect(start().target).toEqual({ kind: 'new', locale: 'zh-CN', title: '张三的简历' });
    const en = start({ name: 'Sam Example CV.pdf' }, filledProfile(), { ...READ, language: { locale: 'en-AU', mixed: false } });
    expect(en.target).toEqual({ kind: 'new', locale: 'en-AU', title: 'Sam Example CV' });
    expect(toDraft(en).draft.locale).toBe('en-AU');
    expect(start({}, null).target.kind).toBe('new');
  });

  it('a file name with nothing usable gives the default title', () => {
    expect(start({ name: '13800138000.pdf' }).target).toEqual({ kind: 'new', locale: 'zh-CN', title: '我的中文简历' });
    expect(start({ name: '' }).target).toEqual({ kind: 'new', locale: 'zh-CN', title: '我的中文简历' });
  });

  it('default target: merge into the active resume when it is blank', () => {
    expect(start({}, blankProfile()).target).toEqual({ kind: 'merge', resumeId: 'r-blank' });
    // A stored attachment alone does not make it filled.
    const withPdf = updateResume(blankProfile(), 'r-blank', (r) => setAttachment(r, 'photoFileId', 'f-photo'));
    expect(start({}, withPdf).target).toEqual({ kind: 'merge', resumeId: 'r-blank' });
    expect(start({}, filledProfile()).target.kind).toBe('new');
  });

  it('default target: merge into the owning resume for an attachment', () => {
    const profile = addResume(filledProfile(), createResume({ title: '第二份', locale: 'zh-CN', id: 'r-owner', now: 1 }));
    const s = start({ source: 'attachment', stored: { fileId: 'f-1', resumeId: 'r-owner' } }, profile);
    expect(s.target).toEqual({ kind: 'merge', resumeId: 'r-owner' });
    expect(s.file.stored).toEqual({ fileId: 'f-1', resumeId: 'r-owner' });
    // The owner was deleted meanwhile: a new resume.
    expect(start({ source: 'attachment', stored: { fileId: 'f-1', resumeId: 'gone' } }, profile).target.kind).toBe('new');
  });

  it('attachPdf: on for a PDF into a new resume, off when the target has a resume PDF, never for Word or an attachment', () => {
    expect(start().attachPdf).toBe(true);
    expect(start({}, blankProfile()).attachPdf).toBe(true);
    const hasPdf = updateResume(blankProfile(), 'r-blank', (r) => setAttachment(r, 'resumeFileId', 'f-old'));
    const merge = start({}, hasPdf);
    expect(merge.target.kind).toBe('merge');
    expect(merge.attachPdf).toBe(false);
    // Switching to a new resume turns it back on, and back to that merge turns it off.
    const toNew = run(merge, { type: 'target', target: { kind: 'new', locale: 'zh-CN', title: 'x' } });
    expect(toNew.attachPdf).toBe(true);
    expect(run(toNew, { type: 'target', target: { kind: 'merge', resumeId: 'r-blank' } }).attachPdf).toBe(false);
    // Once the person has set it, a target switch leaves it alone.
    const chosen = run(start(), { type: 'attachPdf', on: false }, { type: 'target', target: { kind: 'new', locale: 'en-AU', title: 'y' } });
    expect(chosen.attachPdf).toBe(false);

    const word = start({ name: 'a.docx' }, filledProfile(), { ...READ, kind: 'docx' });
    expect(word.attachPdf).toBe(false);
    expect(run(word, { type: 'attachPdf', on: true }).attachPdf).toBe(false);
    const attachment = start({ source: 'attachment', stored: { fileId: 'f', resumeId: 'r-filled' } });
    expect(attachment.attachPdf).toBe(false);
    expect(run(attachment, { type: 'target', target: { kind: 'new', locale: 'zh-CN', title: 'z' } }, { type: 'attachPdf', on: true }).attachPdf).toBe(false);
  });

  it('onlyCheck hides sure items and empty groups but not from the summary', () => {
    const s = start();
    const only = run(s, { type: 'onlyCheck', on: true });
    const groups = groupsOf(only);
    expect(groups.map((g) => g.key)).toEqual(['basics', 'education.0', 'education.1', 'work.0']);
    expect(groups.flatMap((g) => g.items).every((i) => i.certainty === 'check')).toBe(true);
    expect(summaryOf(only)).toEqual(summaryOf(s));
  });
});

describe('overwrite choices', () => {
  it('overwrite turns on and off per path', () => {
    const s = run(start(), { type: 'overwrite', path: 'basics.familyName', on: true }, { type: 'overwrite', path: 'contact.email', on: true }, { type: 'overwrite', path: 'contact.email', on: false });
    expect(s.overwrite).toEqual(['basics.familyName']);
    expect(run(s, { type: 'overwrite', path: 'basics.familyName', on: true }).overwrite).toEqual(['basics.familyName']);
  });
});
