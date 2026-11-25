// Listening and speaking, reading and writing: asked apart from the overall level, answered by their own levels when
// the applicant gave them and by the overall level when not.
import { describe, expect, it } from 'vitest';
import { scanDocument } from '../../../src/engine/scan';
import { planFill } from '../../../src/engine/plan';
import { FILL_THRESHOLD } from '../../../src/engine/classify';
import { createSampleProfile, LanguageEntrySchema, type Resume } from '../../../src/schema';

const levels = '<option value="">请选择</option><option>精通</option><option>熟练</option><option>良好</option><option>一般</option>';
const page = `<form><section><h3>语言能力</h3>
  <div><label for="lang">语种</label><select id="lang"><option value="">请选择</option><option>英语</option><option>日语</option></select></div>
  <div><label for="ls">听说能力</label><select id="ls">${levels}</select></div>
  <div><label for="rw">读写能力</label><select id="rw">${levels}</select></div>
</section></form>`;

function plan(resume: Resume) {
  document.body.innerHTML = page;
  const { contexts, classifications } = scanDocument(document);
  const byId = (id: string) => contexts.findIndex((c) => c.control.el.id === id);
  const p = planFill(contexts, classifications, resume);
  const step = (id: string) => p.steps.find((s) => s.fieldId === contexts[byId(id)]!.control.id);
  return { classifications, byId, step };
}

const zh = () => structuredClone(createSampleProfile().resumes[0]!) as Resume;

describe('language levels asked apart', () => {
  it('knows the two questions', () => {
    const { classifications, byId } = plan(zh());
    expect(classifications[byId('ls')]).toMatchObject({ fieldKey: 'languages.listeningSpeaking' });
    expect(classifications[byId('rw')]).toMatchObject({ fieldKey: 'languages.readingWriting' });
    expect(classifications[byId('ls')]!.confidence).toBeGreaterThanOrEqual(FILL_THRESHOLD);
  });

  it('knows them in English too', () => {
    document.body.innerHTML = `<form><section><h3>Languages</h3>
      <div><label for="l">Language</label><input id="l"></div>
      <div><label for="s">Speaking and listening</label><select id="s"><option value="">Select</option><option>Fluent</option><option>Basic</option></select></div>
      <div><label for="w">Reading and writing</label><select id="w"><option value="">Select</option><option>Fluent</option><option>Basic</option></select></div>
    </section></form>`;
    const { contexts, classifications } = scanDocument(document);
    const key = (id: string) => classifications[contexts.findIndex((c) => c.control.el.id === id)]!.fieldKey;
    expect(key('s')).toBe('languages.listeningSpeaking');
    expect(key('w')).toBe('languages.readingWriting');
  });

  it('answers each with its own level', () => {
    const resume = zh();
    resume.languages[0] = LanguageEntrySchema.parse({ ...resume.languages[0], listeningSpeaking: 'intermediate', readingWriting: 'proficient' });
    const { step } = plan(resume);
    expect(step('ls')?.intent).toMatchObject({ kind: 'choice' });
    expect(step('ls')?.source).toBe('languages[0].listeningSpeaking');
    expect(step('rw')?.source).toBe('languages[0].readingWriting');
  });

  it('falls back to the overall level when the applicant gave none', () => {
    const resume = zh();
    resume.languages[0] = LanguageEntrySchema.parse({ ...resume.languages[0], listeningSpeaking: null, readingWriting: null });
    const { step } = plan(resume);
    expect(step('ls')?.source).toBe('languages[0].proficiency');
    expect(step('rw')?.source).toBe('languages[0].proficiency');
  });

  it('keeps old resumes readable, with both levels empty', () => {
    expect(LanguageEntrySchema.parse({ language: '英语' })).toMatchObject({ listeningSpeaking: null, readingWriting: null });
  });
});
