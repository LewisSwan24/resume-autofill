import { afterEach, describe, expect, it, vi } from 'vitest';
import { computeFrameNeeds } from '../../../src/content/needs';
import { createFrameHandlers } from '../../../src/content/handlers';
import { idFor } from '../../../src/content/ids';
import { isEmptyNeeds } from '../../../src/engine/fieldDeps';

afterEach(() => {
  document.body.innerHTML = '';
});

const mount = (html: string) => {
  document.body.innerHTML = html;
};

describe('computeFrameNeeds', () => {
  it('lists the recognised keys, not the unrecognised fields', () => {
    mount(`<form><h2>基本信息</h2>
      <label for="nm">姓名</label><input id="nm">
      <label for="em">电子邮箱</label><input id="em">
      <label for="vc">验证码</label><input id="vc"></form>`);
    const n = computeFrameNeeds(document, idFor);
    expect(n.fieldKeys).toContain('contact.email');
    expect(n.fieldKeys).toContain('basics.fullName');
    expect(n.fieldKeys.every((k) => !/verif|captcha|code/i.test(k))).toBe(true);
    expect(n.repeatSections).toEqual([]);
    expect(n.attachmentKeys).toEqual([]);
  });

  it('a page without any form needs nothing (third-party frame)', () => {
    mount('<div><h1>Ad</h1><p>Buy things</p><a href="https://x.test/">more</a><button type="button">OK</button></div>');
    const n = computeFrameNeeds(document, idFor);
    expect(isEmptyNeeds(n)).toBe(true);
  });

  it('a form of unrecognised fields needs nothing either, even under a repeated-section heading', () => {
    mount('<form><h2>教育经历</h2><label for="zz">Zebra stripes</label><input id="zz"><label for="q">验证码</label><input id="q"></form>');
    expect(isEmptyNeeds(computeFrameNeeds(document, idFor))).toBe(true);
  });

  it('upload controls become attachment keys, only for real file inputs', () => {
    mount(`<form><label for="cv">上传简历</label><input id="cv" type="file">
      <label for="ph">个人照片</label><input id="ph" type="file">
      <label for="tx">简历</label><input id="tx" type="text"></form>`);
    const n = computeFrameNeeds(document, idFor);
    expect(n.attachmentKeys).toContain('attachments.resume');
    expect(n.fieldKeys.filter((k) => k.startsWith('attachments.'))).toEqual([]);
  });

  it('repeated sections: cards on the page and add buttons both count', () => {
    mount(`<form><h2>教育经历</h2>
      <div><label for="s1">学校名称</label><input id="s1"></div>
      <button type="button">添加教育经历</button>
      <h2>实习经历</h2><button type="button">添加实习经历</button></form>`);
    const n = computeFrameNeeds(document, idFor);
    expect(n.fieldKeys).toContain('education.school');
    expect([...n.repeatSections].sort()).toEqual(['education', 'internship']);
  });

  it('a frame that only has an add button still needs its section (cards are added, then filled)', () => {
    mount('<form><h2>教育经历</h2><button type="button">添加教育经历</button></form>');
    const n = computeFrameNeeds(document, idFor);
    expect(n.fieldKeys).toEqual([]);
    expect(n.repeatSections).toEqual(['education']);
  });

  it('submit buttons and navigating links are not add buttons', () => {
    mount('<form><h2>教育经历</h2><button type="submit">添加教育经历</button><a href="/next">添加教育经历</a></form>');
    expect(isEmptyNeeds(computeFrameNeeds(document, idFor))).toBe(true);
  });

  it('only reads the page: nothing is filled, clicked or highlighted', () => {
    const clicks = vi.fn();
    mount(`<form><label for="em">电子邮箱</label><input id="em"><button type="button" id="add">添加教育经历</button></form>`);
    document.getElementById('add')!.addEventListener('click', clicks);
    const before = document.body.innerHTML;
    computeFrameNeeds(document, idFor);
    expect(document.body.innerHTML).toBe(before);
    expect(clicks).not.toHaveBeenCalled();
  });
});

describe('frame handlers: needs()', () => {
  it('answers without running a fill and without needing any resume data', () => {
    mount('<form><label for="em">电子邮箱</label><input id="em"></form>');
    const runFill = vi.fn();
    const h = createFrameHandlers({ doc: document, idFor, runFill });
    expect(h.needs()).toEqual({ fieldKeys: ['contact.email'], repeatSections: [], attachmentKeys: [] });
    expect(runFill).not.toHaveBeenCalled();
    expect(h.isBusy()).toBe(false);
    expect((document.getElementById('em') as HTMLInputElement).value).toBe('');
  });

  it('uses the injected computeNeeds (tests)', () => {
    const computeNeeds = vi.fn(() => ({ fieldKeys: ['basics.age'], repeatSections: [], attachmentKeys: [] }));
    const h = createFrameHandlers({ doc: document, idFor, computeNeeds });
    expect(h.needs().fieldKeys).toEqual(['basics.age']);
    expect(computeNeeds).toHaveBeenCalledWith(document, idFor);
  });
});