import { afterEach, describe, expect, it } from 'vitest';
import type { EntryEditor } from '../../../src/adapters/types';
import { registerAllDrivers } from '../../../src/drivers';
import { fillEntryEditors } from '../../../src/fill/entryEditors';
import { createSampleFiles, createSampleProfile } from '../../../src/schema';

const zh = createSampleProfile().resumes.find((r) => r.id === 'sample-zh')!;
const resume = structuredClone(zh);
resume.education[0] = { ...resume.education[0]!, school: '星河示例理工大学', schoolEn: '' };
resume.education[1] = { ...resume.education[1]!, school: '云岭示例大学', schoolEn: '' };
const files = createSampleFiles();

const editor: EntryEditor = {
  section: 'education',
  title: '教育经历',
  root: '#edu',
  add: '.add',
  editor: '.editor',
  save: '.save',
  cancel: '.cancel',
  saved: '.saved',
  identity: { school: '.school' },
  fields: ['education.school', 'education.major'],
};

/** A section that opens one editor per Add and moves it into the list on Save, unless `refuse`. */
function mount(saved: string[], refuse = false) {
  document.body.innerHTML = `<section id="edu"><h2>教育经历</h2>
    <div class="list">${saved.map((s) => `<div class="saved"><span class="school">${s}</span></div>`).join('')}</div>
    <button type="button" class="add">添加</button></section>`;
  const root = document.getElementById('edu')!;
  root.querySelector('.add')!.addEventListener('click', () => {
    root.insertAdjacentHTML(
      'beforeend',
      `<div class="editor"><label for="sch">学校名称</label><input id="sch"><label for="maj">专业</label><input id="maj">
        <button type="button" class="save">保存</button><button type="button" class="cancel">取消</button></div>`,
    );
    const box = root.querySelector('.editor')!;
    box.querySelector('.save')!.addEventListener('click', () => {
      if (refuse) return;
      const school = (box.querySelector('#sch') as HTMLInputElement).value;
      root.querySelector('.list')!.insertAdjacentHTML('beforeend', `<div class="saved"><span class="school">${school}</span></div>`);
      box.remove();
    });
    box.querySelector('.cancel')!.addEventListener('click', () => box.remove());
  });
}

let n = 0;
const idFor = (() => {
  const ids = new WeakMap<HTMLElement, string>();
  return (el: HTMLElement) => ids.get(el) ?? (ids.set(el, `ed${++n}`), ids.get(el)!);
})();

afterEach(() => {
  document.body.innerHTML = '';
});

describe('fillEntryEditors: what became of each entry', () => {
  registerAllDrivers();

  it('says the page already had one entry, added the other, and numbers that entry’s fields', async () => {
    mount(['星河示例理工大学']);
    const run = await fillEntryEditors(document, [editor], { resume, files, idFor });
    expect(run.entries).toEqual([
      { section: 'education', index: 0, state: 'held', label: '星河示例理工大学' },
      { section: 'education', index: 1, state: 'added', label: '云岭示例大学' },
    ]);
    expect(run.results.length).toBeGreaterThan(0);
    expect(run.results.every((r) => r.entry === 1)).toBe(true);
  });

  it('says an entry stays in its open editor when the page will not save it', async () => {
    mount([], true);
    const run = await fillEntryEditors(document, [editor], { resume, files, idFor });
    expect(run.entries).toEqual([
      { section: 'education', index: 0, state: 'skipped', reason: 'editor_held', label: '星河示例理工大学' },
      { section: 'education', index: 1, state: 'skipped', reason: 'editor_held', label: '云岭示例大学' },
    ]);
  });
});
