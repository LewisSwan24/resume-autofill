// Works (作品): a list of the applicant's pieces with a title, a link, a description and a file. A work's own file goes
// in when it has one, the portfolio file from the attachments when not.
import { describe, expect, it } from 'vitest';
import { scanDocument } from '../../../src/engine/scan';
import { planFill } from '../../../src/engine/plan';
import { FILL_THRESHOLD } from '../../../src/engine/classify';
import { computeFrameNeeds } from '../../../src/content/needs';
import { idFor } from '../../../src/content/ids';
import type { FileData } from '../../../src/drivers/types';
import { createSampleProfile, ResumeSchema, type Resume } from '../../../src/schema';

const zhPage = `<form><section><h3>作品</h3>
  <div><label for="t">作品名称</label><input id="t"></div>
  <div><label for="l">作品链接</label><input id="l"></div>
  <div><label for="d">作品描述</label><textarea id="d"></textarea></div>
  <div><label for="f">作品附件</label><input id="f" type="file"></div>
</section></form>`;

const enPage = `<form><section><h3>Work samples</h3>
  <div><label for="t">Title</label><input id="t"></div>
  <div><label for="l">Link</label><input id="l"></div>
  <div><label for="d">Description</label><textarea id="d"></textarea></div>
</section></form>`;

const file = (name: string): FileData => ({ name, type: 'application/pdf', dataUrl: 'data:application/pdf;base64,AA==' });

function withWork(extra: Partial<Resume['works'][number]> = {}): Resume {
  const base = structuredClone(createSampleProfile().resumes[0]!) as Resume;
  return ResumeSchema.parse({
    ...base,
    works: [{ title: '校园导览小程序', link: 'https://example.com/guide', description: '为新生做的校园导览小程序。', ...extra }],
    attachments: { ...base.attachments, portfolioFileId: 'portfolio-1' },
  });
}

function run(html: string, resume: Resume, files: Record<string, FileData> = {}) {
  document.body.innerHTML = html;
  const { contexts, classifications } = scanDocument(document, idFor);
  const at = (id: string) => contexts.findIndex((c) => c.control.el.id === id);
  const plan = planFill(contexts, classifications, resume, files);
  const step = (id: string) => plan.steps.find((s) => s.fieldId === contexts[at(id)]!.control.id);
  return { classifications, at, step };
}

describe('works', () => {
  it('knows the boxes of a works card', () => {
    const { classifications, at } = run(zhPage, withWork());
    expect(classifications[at('t')]).toMatchObject({ fieldKey: 'works.title', section: 'works' });
    expect(classifications[at('l')]).toMatchObject({ fieldKey: 'works.link' });
    expect(classifications[at('d')]).toMatchObject({ fieldKey: 'works.description' });
    expect(classifications[at('f')]).toMatchObject({ fieldKey: 'works.fileId' });
    expect(classifications[at('t')]!.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it('knows a card of work samples in English', () => {
    const { classifications, at } = run(enPage, withWork());
    expect(classifications[at('t')]!.fieldKey).toBe('works.title');
    expect(classifications[at('l')]!.fieldKey).toBe('works.link');
    expect(classifications[at('d')]!.fieldKey).toBe('works.description');
  });

  it('fills the card from the first work, with the portfolio file when the work has none', () => {
    const { step } = run(zhPage, withWork(), { 'portfolio-1': file('portfolio.pdf') });
    expect(step('t')).toMatchObject({ source: 'works[0].title', intent: { kind: 'text', text: '校园导览小程序' } });
    expect(step('l')?.source).toBe('works[0].link');
    expect(step('d')?.source).toBe('works[0].description');
    expect(step('f')).toMatchObject({ source: 'attachments.portfolioFileId', intent: { kind: 'file' } });
  });

  it('takes the work’s own file first', () => {
    const { step } = run(zhPage, withWork({ fileId: 'work-file' }), { 'work-file': file('guide.pdf'), 'portfolio-1': file('p.pdf') });
    expect(step('f')).toMatchObject({ source: 'works[0].fileId', intent: { kind: 'file', file: { name: 'guide.pdf' } } });
  });

  it('asks the background for the works and the portfolio file', () => {
    document.body.innerHTML = zhPage;
    const needs = computeFrameNeeds(document, idFor);
    expect(needs.repeatSections).toContain('works');
    expect(needs.fieldKeys).toEqual(expect.arrayContaining(['works.title', 'works.link', 'works.description', 'works.fileId']));
    expect(needs.attachmentKeys).toContain('attachments.portfolio');
  });

  it('keeps old resumes readable, with no works', () => {
    expect(ResumeSchema.parse({ id: 'x', title: 'X', locale: 'zh-CN' }).works).toEqual([]);
  });
});

describe('a works card with no works in the resume', () => {
  it('takes the portfolio link and file, and nothing else', () => {
    const base = structuredClone(createSampleProfile().resumes[0]!) as Resume;
    const resume = ResumeSchema.parse({
      ...base, works: [], contact: { ...base.contact, portfolio: 'https://example.com/me' },
      attachments: { ...base.attachments, portfolioFileId: 'portfolio-1' },
    });
    const { step } = run(zhPage, resume, { 'portfolio-1': file('portfolio.pdf') });
    expect(step('l')).toMatchObject({ source: 'contact.portfolio', intent: { text: 'https://example.com/me' } });
    expect(step('f')?.source).toBe('attachments.portfolioFileId');
    expect(step('t')).toBeUndefined();
  });
});
