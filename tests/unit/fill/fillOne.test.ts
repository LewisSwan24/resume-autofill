// The side panel's own fills: one box by the key the applicant chose ("fill this one", "use selected"), and a run
// limited to the boxes that failed or were not recognised ("retry"). Neither touches any other box.
import { afterEach, describe, expect, it } from 'vitest';
import { idFor } from '../../../src/content/ids';
import { fillOneField, runFill } from '../../../src/fill/runFill';
import { clearHighlights } from '../../../src/fill/highlight';
import { createSampleFiles, createSampleProfile, type Resume } from '../../../src/schema';

const zh = createSampleProfile().resumes.find((r) => r.id === 'sample-zh')! as Resume;
const files = createSampleFiles();

const page = () => {
  document.body.innerHTML = `<form><h2>基本信息</h2>
    <div><label for="nm">姓名</label><input id="nm"></div>
    <div><label for="em">邮箱</label><input id="em"></div>
    <div><label for="xx">其他说明</label><input id="xx"></div>
  </form>`;
};
const box = (id: string) => document.getElementById(id) as HTMLInputElement;

afterEach(() => {
  clearHighlights();
  document.body.innerHTML = '';
});

describe('fillOneField', () => {
  it('fills one box with the resume’s answer for the key chosen, and nothing else', async () => {
    page();
    const { report: result } = await fillOneField(document, { resume: zh, files }, idFor(box('xx')), 'contact.email', { idFor });
    expect(result).toMatchObject({ outcome: 'filled', fieldKey: 'contact.email', source: 'contact.email' });
    expect(box('xx').value).toBe(zh.contact.email);
    expect(box('nm').value).toBe('');
    expect(box('em').value).toBe('');
  });

  it('says no_data for a key the resume has nothing for, and no_control for a box that is gone', async () => {
    page();
    expect((await fillOneField(document, { resume: zh, files }, idFor(box('xx')), 'contact.qq', { idFor })).report.outcome).toBe('no_data');
    const gone = idFor(box('xx'));
    box('xx').remove();
    expect((await fillOneField(document, { resume: zh, files }, gone, 'contact.email', { idFor })).report.outcome).toBe('no_control');
  });
});

describe('a run limited to some boxes', () => {
  it('fills only those boxes and reports only them', async () => {
    page();
    const run = await runFill(document, { resume: zh, files }, { idFor, filter: { onlyFieldIds: [idFor(box('em'))] } });
    expect(box('em').value).toBe(zh.contact.email);
    expect(box('nm').value).toBe('');
    expect(run.report.fields.map((f) => f.fieldId)).toEqual([idFor(box('em'))]);
  });
});
