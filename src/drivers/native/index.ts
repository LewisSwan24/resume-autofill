// Native driver: <input>, <textarea>, <select>, radio / checkbox groups, date / month inputs,
// contenteditable editors and file inputs. Every fill verifies by reading the control back.
import { groupInputs } from '../../engine/discover';
import type { Control, ControlKind } from '../../engine/types';
import type { Driver, DriverContext, FillIntent, FillResult } from '../types';
import { fillCheckbox, fillRadio, readChecked } from './choice';
import { fillDate, readDateRange } from './date';
import { fillFile, readFiles } from './file';
import { fillRichtext } from './richtext';
import { fillSelect, readSelect } from './select';
import { failed, squash } from './shared';
import { fillText, textOf } from './text';

export { decodeBase64, parseDataUrl } from './file';

const NATIVE_KINDS: ControlKind[] = ['text', 'textarea', 'select', 'radio', 'checkbox', 'date', 'file', 'richtext'];

// ------------------------------------------------------------------ driver

function read(control: Control): string | null {
  const el = control.el;
  switch (control.kind) {
    case 'text':
    case 'textarea':
      return (el as HTMLInputElement).value;
    case 'date':
      return control.dateRange ? readDateRange(el) : (el as HTMLInputElement).value;
    case 'select':
      return readSelect(el as HTMLSelectElement);
    case 'radio':
      return readChecked(control);
    case 'checkbox': {
      const inputs = groupInputs(control);
      return inputs.length === 1 && !control.multiple ? String(inputs[0]!.checked) : readChecked(control);
    }
    case 'richtext':
      return squash(el.textContent);
    case 'file':
      return readFiles(control);
    default:
      return null;
  }
}

async function fill(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  try {
    switch (control.kind) {
      case 'text':
      case 'textarea':
      case 'richtext': {
        const text = textOf(intent);
        if (text === null) return failed(`unsupported intent for ${control.kind}: ${intent.kind}`);
        return control.kind === 'richtext' ? await fillRichtext(control, text, ctx) : await fillText(control, text, ctx);
      }
      case 'date':
        return await fillDate(control, intent, ctx);
      case 'select':
        return await fillSelect(control, intent, ctx);
      case 'radio':
        return await fillRadio(control, intent, ctx);
      case 'checkbox':
        return await fillCheckbox(control, intent, ctx);
      case 'file':
        return await fillFile(control, intent, ctx);
      default:
        return failed(`native driver cannot fill ${control.kind}`);
    }
  } catch (error) {
    return failed(error instanceof Error ? error.message : String(error), safeRead(control));
  }
}

function safeRead(control: Control): string | null {
  try {
    return read(control);
  } catch {
    return null;
  }
}

export const nativeDriver: Driver = {
  id: 'native',
  lib: 'native',
  kinds: NATIVE_KINDS,
  // Radio / checkbox widgets of UI libraries wrap real <input>s, so they stay drivable natively
  // unless a library driver registers itself and takes precedence.
  match: (control) =>
    NATIVE_KINDS.includes(control.kind) &&
    (control.lib === 'native' || control.kind === 'radio' || control.kind === 'checkbox'),
  fill,
  read,
};
