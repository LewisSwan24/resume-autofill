import { describe, expect, it } from 'vitest';
import { ADD_BUTTON_TEXT, DELETE_TEXT, isAddButtonText, isDeleteText } from '../../../src/dictionary/addButtons';

describe('ADD_BUTTON_TEXT / DELETE_TEXT', () => {
  it('contain the documented entries', () => {
    for (const s of ['添加', '新增', '增加', '继续添加', '+', 'Add', 'Add another', 'Add more']) {
      expect(ADD_BUTTON_TEXT).toContain(s);
    }
    for (const s of ['删除', '移除', 'Remove', 'Delete', 'trash']) expect(DELETE_TEXT).toContain(s);
  });
});

describe('isAddButtonText', () => {
  it.each([
    '添加', '新增', '增加', '继续添加', '+', '＋', 'Add', 'add', 'Add another', 'Add more', ' + 添加 ',
    '添加教育经历', '新增一条', '+ 添加工作经历', '继续添加一项', 'Add education', 'Add another position',
    '+ Add', '+ Add work experience', 'ADD ANOTHER', '再添加一条',
  ])('%j → true', (s) => expect(isAddButtonText(s)).toBe(true));

  it.each([
    '', '   ', '删除', 'Delete', 'Remove', 'Submit', '提交', 'Address', 'Add to calendar',
    'Additional information', '不要添加', 'Next', '保存',
    'Add your full legal name exactly as it appears on your passport and other documents',
  ])('%j → false', (s) => expect(isAddButtonText(s)).toBe(false));
});

describe('isDeleteText', () => {
  it.each([
    '删除', '移除', 'Remove', 'Delete', 'trash', 'delete', '删除该条', 'Remove this education',
    'Delete entry', 'icon-trash', 'trash-icon', ' 移除 ', 'REMOVE',
  ])('%j → true', (s) => expect(isDeleteText(s)).toBe(true));

  it.each(['', '添加', 'Add', 'Submit', 'Removal policy is unknown to us and long', '保存', 'Edit'])(
    '%j → false',
    (s) => expect(isDeleteText(s)).toBe(false),
  );
});
