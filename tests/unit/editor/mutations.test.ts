import { describe, expect, it } from 'vitest';
import { ProfileSchema, ResumeSchema, createSampleProfile, type Profile, type Resume } from '../../../src/schema';
import {
  addEntry,
  addResume,
  createResume,
  duplicateResume,
  getByPath,
  moveEntry,
  parsePath,
  pruneMissingAttachments,
  referencedFileIds,
  removeEntry,
  removeResume,
  setActive,
  setAttachment,
  setByPath,
  setEndDate,
  setLinkedResume,
  toggleCurrent,
  updateResume,
} from '../../../src/editor';

const resume = (id = 'r1'): Resume => ResumeSchema.parse({ id, title: id, locale: 'zh-CN' });
const profileOf = (...ids: string[]): Profile =>
  ProfileSchema.parse({ schemaVersion: 1, resumes: ids.map((id) => resume(id)), activeResumeId: ids[0] ?? null });

describe('paths', () => {
  it('parses dotted and bracket paths', () => {
    expect(parsePath('a.b[2].c')).toEqual(['a', 'b', 2, 'c']);
    expect(parsePath('education.0.school')).toEqual(['education', 0, 'school']);
  });

  it('getByPath reads nested values and tolerates gaps', () => {
    const r = { a: { b: [{ c: 1 }] } };
    expect(getByPath(r, 'a.b[0].c')).toBe(1);
    expect(getByPath(r, 'a.x.y')).toBeUndefined();
  });

  it('setByPath is immutable and clones only the touched branch', () => {
    const r = resume();
    const next = setByPath(r, 'basics.familyName', '林');
    expect(next.basics.familyName).toBe('林');
    expect(r.basics.familyName).toBe('');
    expect(next.contact).toBe(r.contact);
    expect(next.basics).not.toBe(r.basics);
  });

  it('setByPath handles array indexes and nested objects', () => {
    const r = addEntry(resume(), 'education');
    const next = setByPath(r, 'education[0].school', '浙江大学');
    expect(next.education[0]!.school).toBe('浙江大学');
    expect(Array.isArray(next.education)).toBe(true);
    expect(setByPath(r, 'contact.address.city', 'Perth').contact.address.city).toBe('Perth');
    expect(setByPath(r, 'basics.nativePlace.province', '浙江省').basics.nativePlace).toEqual({ province: '浙江省' });
  });

  it('setByPath creates missing containers', () => {
    expect(setByPath({}, 'a.b[1]', 'x')).toEqual({ a: { b: [undefined, 'x'] } });
  });
});

describe('repeatable entries', () => {
  it('addEntry appends schema defaults without mutating the source', () => {
    const r = resume();
    const next = addEntry(r, 'education');
    expect(next.education).toHaveLength(1);
    expect(next.education[0]).toMatchObject({ school: '', degree: null, endDate: null, current: false });
    expect(r.education).toHaveLength(0);
    expect(addEntry(next, 'work').work[0]!.kind).toBe('full_time');
  });

  it('removeEntry removes by index and ignores bad indexes', () => {
    let r = resume();
    for (const name of ['a', 'b', 'c']) r = addEntry(r, 'skills', { name, level: '' });
    expect(removeEntry(r, 'skills', 1).skills.map((s) => s.name)).toEqual(['a', 'c']);
    expect(removeEntry(r, 'skills', 3)).toBe(r);
    expect(removeEntry(r, 'skills', -1)).toBe(r);
  });

  it('moveEntry swaps neighbours and is a no-op at the ends', () => {
    let r = resume();
    for (const name of ['a', 'b', 'c']) r = addEntry(r, 'skills', { name, level: '' });
    const names = (x: Resume) => x.skills.map((s) => s.name).join('');
    expect(names(moveEntry(r, 'skills', 2, -1))).toBe('acb');
    expect(names(moveEntry(r, 'skills', 0, 1))).toBe('bac');
    expect(moveEntry(r, 'skills', 0, -1)).toBe(r);
    expect(moveEntry(r, 'skills', 2, 1)).toBe(r);
    expect(names(r)).toBe('abc');
  });
});

describe('present / current', () => {
  const base = { endDate: '2024-06', current: false };
  it('checking sets endDate=null and current=true', () => {
    expect(toggleCurrent(base, true)).toEqual({ endDate: null, current: true });
  });
  it('unchecking sets current=false and an empty end date', () => {
    expect(toggleCurrent({ endDate: null, current: true }, false)).toEqual({ endDate: '', current: false });
  });
  it('picking an end date clears current', () => {
    expect(setEndDate({ endDate: null, current: true }, '2025-01')).toEqual({ endDate: '2025-01', current: false });
  });
});

describe('resumes in a profile', () => {
  it('createResume yields a valid empty resume; en-AU defaults to +61', () => {
    const zh = createResume({ title: '新', locale: 'zh-CN', id: 'z' });
    const en = createResume({ title: 'New', locale: 'en-AU', id: 'e' });
    expect(ResumeSchema.safeParse(zh).success).toBe(true);
    expect(zh.contact.phoneCountryCode).toBe('+86');
    expect(en.contact.phoneCountryCode).toBe('+61');
  });

  it('duplicateResume deep-copies with a new id and no link', () => {
    const sample = createSampleProfile().resumes[0]!;
    const copy = duplicateResume(sample, { title: 'Copy', id: 'copy', now: 5 });
    expect(copy.id).toBe('copy');
    expect(copy.linkedResumeId).toBeUndefined();
    expect(copy.createdAt).toBe(5);
    expect({ ...copy, id: sample.id, title: sample.title, createdAt: sample.createdAt, updatedAt: sample.updatedAt })
      .toEqual({ ...sample, linkedResumeId: undefined });
    expect(copy.education).not.toBe(sample.education);
  });

  it('addResume activates the first resume, or the new one on request', () => {
    const empty = ProfileSchema.parse({ schemaVersion: 1 });
    const one = addResume(empty, resume('a'));
    expect(one.activeResumeId).toBe('a');
    expect(addResume(one, resume('b')).activeResumeId).toBe('a');
    expect(addResume(one, resume('b'), { activate: true }).activeResumeId).toBe('b');
  });

  it('removeResume clears links and moves the active id', () => {
    let p = profileOf('a', 'b', 'c');
    p = setLinkedResume(p, 'b', 'a');
    p = setActive(p, 'a');
    const next = removeResume(p, 'a');
    expect(next.resumes.map((r) => r.id)).toEqual(['b', 'c']);
    expect(next.resumes[0]!.linkedResumeId).toBeUndefined();
    expect(next.activeResumeId).toBe('b');
    expect(removeResume(profileOf('only'), 'only').activeResumeId).toBeNull();
    expect(removeResume(p, 'zzz')).toBe(p);
  });

  it('setActive / setLinkedResume ignore unknown ids and self links', () => {
    const p = profileOf('a', 'b');
    expect(setActive(p, 'zzz')).toBe(p);
    expect(setLinkedResume(p, 'a', 'a')).toBe(p);
    expect(setLinkedResume(p, 'a', 'zzz')).toBe(p);
    const linked = setLinkedResume(p, 'a', 'b');
    expect(linked.resumes[0]!.linkedResumeId).toBe('b');
    expect(setLinkedResume(linked, 'a', null).resumes[0]!.linkedResumeId).toBeUndefined();
  });

  it('updateResume only touches the target', () => {
    const p = profileOf('a', 'b');
    const next = updateResume(p, 'b', (r) => ({ ...r, title: 'B2' }));
    expect(next.resumes.map((r) => r.title)).toEqual(['a', 'B2']);
    expect(next.resumes[0]).toBe(p.resumes[0]);
    expect(updateResume(p, 'zzz', (r) => r)).toBe(p);
  });
});

describe('attachments', () => {
  it('setAttachment sets and clears slots', () => {
    const r = setAttachment(resume(), 'photoFileId', 'f1');
    expect(r.attachments).toEqual({ photoFileId: 'f1' });
    expect(setAttachment(r, 'photoFileId', null).attachments).toEqual({});
  });

  it('referencedFileIds + pruneMissingAttachments', () => {
    let p = profileOf('a', 'b');
    p = updateResume(p, 'a', (r) => setAttachment(setAttachment(r, 'resumeFileId', 'f1'), 'photoFileId', 'f2'));
    p = updateResume(p, 'b', (r) => setAttachment(r, 'resumeFileId', 'f1'));
    expect([...referencedFileIds(p)].sort()).toEqual(['f1', 'f2']);
    const pruned = pruneMissingAttachments(p, new Set(['f1']));
    expect(pruned.resumes[0]!.attachments).toEqual({ resumeFileId: 'f1' });
    expect(pruned.resumes[1]!.attachments).toEqual({ resumeFileId: 'f1' });
  });
});
