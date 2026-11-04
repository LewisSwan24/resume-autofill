// Element Plus driver: el-upload.
import { normalizeLabel } from '../../dictionary/normalize';
import type { Control } from '../../engine/types';
import { fireChange, makeEvent, winOf } from '../events';
import { parseDataUrl } from '../native';
import type { DriverContext, FillIntent, FillResult } from '../types';
import { waitFor } from '../wait';
import { failed, squash } from './shared';

// ------------------------------------------------------------------ el-upload

/** File names in the upload list (a sibling of the `.el-upload` trigger, inside the same form item). */
export function readUpload(root: Element): string | null {
  const scope = root.closest('.el-form-item__content') ?? root.parentElement ?? root;
  const names = Array.from(scope.querySelectorAll('.el-upload-list__item-name'))
    .map((n) => squash(n.textContent))
    .filter(Boolean);
  return names.length > 0 ? names.join(', ') : null;
}

export async function fillUpload(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'file') return failed(`unsupported intent for el-upload: ${intent.kind}`);
  const root = control.el;
  const input = root.querySelector<HTMLInputElement>('input[type=file]');
  if (!input) return failed('upload has no file input');
  const win = winOf(input);
  const { name, type, dataUrl } = intent.file;
  // Already listed (a second fill run): el-upload is additive, so uploading again would duplicate the file.
  const listed = readUpload(root);
  if (listed !== null && listed.split(', ').some((n) => normalizeLabel(n) === normalizeLabel(name))) {
    return { ok: true, observed: listed };
  }
  const parsed = parseDataUrl(dataUrl);
  const file = new win.File([parsed.bytes as BlobPart], name, { type: type || parsed.mime });
  const DT = (win as unknown as { DataTransfer?: new () => DataTransfer }).DataTransfer;
  if (typeof DT !== 'function') return failed('DataTransfer is not available');
  const dt = new DT();
  dt.items.add(file);
  input.files = dt.files;
  // Element Plus reads the files in its `change` handler (and then clears the input).
  input.dispatchEvent(makeEvent(input, ['Event'], 'input'));
  fireChange(input);
  const shown = await waitFor(
    () => {
      const v = readUpload(root);
      return v !== null && v.split(', ').some((n) => normalizeLabel(n) === normalizeLabel(name)) ? v : null;
    },
    { timeout: Math.min(ctx.timeoutMs, 2000), root: ctx.doc, signal: ctx.signal },
  );
  return shown !== null
    ? { ok: true, observed: shown }
    : failed('file did not appear in the upload list', readUpload(root));
}
