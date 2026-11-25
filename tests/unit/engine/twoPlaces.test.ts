// A place asked twice on one form, once on a picker and once in a text box (所在地点 on a tree, 目前所在地 typed): both
// get the answer. Asked twice on the same kind of box, it is still given once.
import { describe, expect, it } from 'vitest';
import { scanDocument } from '../../../src/engine/scan';
import { planFill } from '../../../src/engine/plan';
import { createSampleProfile, type Resume } from '../../../src/schema';

const zh = createSampleProfile().resumes[0] as Resume;
const picker = (id: string, label: string) =>
  `<div><label for="${id}">${label}</label><select id="${id}"><option value="">请选择</option><option>北京</option><option>上海</option><option>杭州</option></select></div>`;
const box = (id: string, label: string) => `<div><label for="${id}">${label}</label><input id="${id}"></div>`;

function keys(html: string) {
  document.body.innerHTML = `<form><h3>基本信息</h3>${box('nm', '姓名')}${html}</form>`;
  const { contexts, classifications } = scanDocument(document);
  const key = (id: string) => classifications[contexts.findIndex((c) => c.control.el.id === id)]!.fieldKey;
  return { key, plan: () => planFill(contexts, classifications, zh), contexts };
}

describe('a place asked twice', () => {
  it('gives the place to a picker and to a text box alike', () => {
    const { key } = keys(`${picker('tree', '所在地点')}${box('text', '目前所在地')}`);
    expect(key('tree')).toBe('basics.currentLocation');
    expect(key('text')).toBe('basics.currentLocation');
  });

  it('still gives it once when both boxes are of one kind', () => {
    const { key } = keys(`${box('a', '所在地点')}${box('b', '目前所在地')}`);
    expect([key('a'), key('b')].filter((k) => k === 'basics.currentLocation')).toHaveLength(1);
  });

  it('keeps the rule for keys that are not places', () => {
    const { key } = keys(`${box('p1', '手机号码')}${picker('p2', '手机号码')}`);
    expect([key('p1'), key('p2')].filter((k) => k === 'contact.phone')).toHaveLength(1);
  });
});
