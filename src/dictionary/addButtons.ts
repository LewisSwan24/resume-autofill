// Recognition of "add another entry" and "delete entry" controls on repeated-card forms.
import { normalizeLabel } from './normalize';

export const ADD_BUTTON_TEXT: string[] = [
  '添加', '新增', '增加', '继续添加', '再添加', '添加更多', '+', 'Add', 'Add another', 'Add more', 'Add new',
];

export const DELETE_TEXT: string[] = ['删除', '移除', '清除', 'Remove', 'Delete', 'trash'];

const ADD_PREFIXES_CJK = ['继续添加', '再添加', '再增加', '添加', '新增', '增加'];
const MAX_LATIN_WORDS = 6;
const MAX_CJK_LENGTH = 14;

const stripPlus = (s: string) => s.replace(/^[\s+＋]+/, '');

/** True for add-entry buttons: "添加", "+ 添加教育经历", "Add another position", "+". */
export function isAddButtonText(s: string): boolean {
  const raw = s.normalize('NFKC').trim();
  if (/^\++$/.test(raw)) return true;
  const t = normalizeLabel(stripPlus(raw));
  if (!t) return false;
  if (/[\u3400-\u9fff]/.test(t)) {
    return t.length <= MAX_CJK_LENGTH && ADD_PREFIXES_CJK.some((p) => t.startsWith(p));
  }
  const words = t.split(' ');
  if (words[0] !== 'add' || words.length > MAX_LATIN_WORDS) return false;
  return words[1] !== 'to';
}

const DELETE_WORD = /(?<![a-z])(?:delete|remove|trash)(?![a-z])/;
const DELETE_CJK = ['删除', '移除', '清除'];

/** True for delete-entry controls, including icon class names / aria labels such as "icon-trash". */
export function isDeleteText(s: string): boolean {
  const t = normalizeLabel(s);
  if (!t) return false;
  if (DELETE_CJK.some((w) => t.includes(w))) return t.length <= MAX_CJK_LENGTH;
  if (t.split(/[\s]+/).length > 4) return false;
  return DELETE_WORD.test(t.replace(/[-_]/g, ' '));
}
