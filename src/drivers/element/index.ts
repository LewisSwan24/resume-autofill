// Element Plus 2.x drivers (Task 16): el-select (single / multiple / filterable remote), el-cascader,
// el-date-picker (year / month / date) and el-upload. el-radio-group / el-checkbox wrap real <input>s,
// so the native driver keeps handling them.
//
// Element Plus teleports every popper to <body> and keeps closed ones in the DOM (display:none, plus
// a ~300 ms leave animation). The right popper is therefore resolved by id (the combobox's
// `aria-controls`, or the trigger's `aria-describedby`), never by "the visible one".
import type { Control } from '../../engine/types';
import type { Driver } from '../types';
import { fillCascader, readCascader } from './cascader';
import { fillDate, readRange } from './date';
import { fillSelect, readSelect } from './select';
import { failed, squash } from './shared';
import { fillUpload, readUpload } from './upload';

// ------------------------------------------------------------------ drivers

function make(
  id: string,
  kind: Control['kind'],
  fill: Driver['fill'],
  read: (root: Element) => string | null,
): Driver {
  return {
    id,
    lib: 'element',
    kinds: [kind],
    match: (c) => c.lib === 'element' && c.kind === kind,
    async fill(control, intent, ctx) {
      try {
        return await fill(control, intent, ctx);
      } catch (error) {
        return failed(error instanceof Error ? error.message : String(error), read(control.el));
      }
    },
    read: (c) => read(c.el),
  };
}

const readDate = (root: Element): string | null =>
  root.classList.contains('el-range-editor') ? readRange(root as HTMLElement) :
  squash(root.querySelector<HTMLInputElement>('input')?.value) || null;

export const elementDrivers: Driver[] = [
  make('element-select', 'select', fillSelect, readSelect),
  make('element-cascader', 'cascader', fillCascader, readCascader),
  make('element-date', 'date', fillDate, readDate),
  make('element-upload', 'file', fillUpload, readUpload),
];
