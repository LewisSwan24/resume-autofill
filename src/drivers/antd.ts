// antd v5 drivers (Task 15). Registered via src/drivers/index.ts.
//   select (single / multiple / showSearch), cascader, date picker (date | month | year), upload.
// Radio.Group and Checkbox stay with the native driver: their wrappers hold real <input>s, which the
// native driver (and registry fallback) already clicks and reads back correctly.
import type { Control } from '../engine/types';
import { failed, squash } from './antdShared';
import { antdDateDriver } from './antdPicker';
import { antdCascaderDriver, antdSelectDriver } from './antdSelect';
import { nativeDriver } from './native';
import type { Driver, DriverContext, FillIntent, FillResult } from './types';
import { waitFor } from './wait';

// ------------------------------------------------------------------ upload

const fileInput = (root: HTMLElement): HTMLInputElement | null => root.querySelector<HTMLInputElement>('input[type=file]');

/** File names antd lists for this upload (`.ant-upload-list-item-name` lives beside the trigger, in the wrapper). */
function listedNames(root: HTMLElement): string[] {
  const scope = root.closest('.ant-upload-wrapper') ?? root.parentElement ?? root;
  return Array.from(scope.querySelectorAll('.ant-upload-list-item-name'), (el) => squash(el.textContent)).filter(Boolean);
}

function readUpload(control: Control): string | null {
  const names = listedNames(control.el);
  if (names.length > 0) return names.join(', ');
  const files = fileInput(control.el)?.files;
  return files && files.length > 0 ? Array.from(files, (f) => f.name).join(', ') : null;
}

async function fillUpload(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'file') return failed(`unsupported intent for antd upload: ${intent.kind}`);
  const input = fileInput(control.el);
  if (!input) return failed('file input not found inside .ant-upload');
  // Already listed (a second fill run): nothing to upload again.
  if (listedNames(control.el).includes(intent.file.name)) return { ok: true, observed: readUpload(control) };
  // The hidden input is a plain <input type=file>: let the native driver inject the File and fire input + change.
  const inner: Control = { ...control, el: input, kind: 'file', lib: 'native', inputType: 'file' };
  const attached = await nativeDriver.fill(inner, intent, ctx);
  if (!attached.ok) return attached;
  // Success = antd's own state took the file, i.e. it rendered the name in its list
  // (an upload with `showUploadList={false}` would be reported as failed: the read-back cannot tell).
  const name = intent.file.name;
  const listed = await waitFor(() => listedNames(control.el).includes(name) || null, {
    timeout: Math.min(ctx.timeoutMs, 1500),
    root: control.el.ownerDocument,
    signal: ctx.signal,
  });
  return listed !== null
    ? { ok: true, observed: readUpload(control) }
    : failed('antd did not list the uploaded file', readUpload(control));
}

export const antdUploadDriver: Driver = {
  id: 'antd-upload',
  lib: 'antd',
  kinds: ['file'],
  match: (c) => c.el.classList.contains('ant-upload') && fileInput(c.el) !== null,
  fill: async (c, i, ctx) => {
    try {
      return await fillUpload(c, i, ctx);
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error), readUpload(c));
    }
  },
  read: readUpload,
};

export const antdDrivers: Driver[] = [antdSelectDriver, antdCascaderDriver, antdDateDriver, antdUploadDriver];

