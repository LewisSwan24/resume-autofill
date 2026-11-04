// Native driver: file inputs and the base64 / data-URL decoders.
import type { Control } from '../../engine/types';
import { fireChange, fireInput, winOf } from '../events';
import type { DriverContext, FillIntent, FillResult } from '../types';
import { failed, settle } from './shared';

// ------------------------------------------------------------------ file

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

/** Decode base64 / base64url without atob or fetch. Throws on a stray character. */
export function decodeBase64(input: string): Uint8Array {
  const s = input.replace(/[\s=]+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const out = new Uint8Array(Math.floor((s.length * 3) / 4));
  let bits = 0;
  let acc = 0;
  let n = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error('invalid base64 data');
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[n++] = (acc >> bits) & 0xff;
    }
  }
  return out.slice(0, n);
}

/** Parse `data:[<mime>][;base64],<payload>` into bytes. */
export function parseDataUrl(dataUrl: string): { mime: string; bytes: Uint8Array } {
  const m = /^data:([^,]*?),([\s\S]*)$/i.exec(dataUrl.trim());
  if (!m) throw new Error('not a data URL');
  const meta = m[1]!;
  const payload = m[2]!;
  const isBase64 = /;base64$/i.test(meta);
  const mime = meta.replace(/;base64$/i, '').split(';')[0] ?? '';
  if (isBase64) return { mime, bytes: decodeBase64(payload.includes('%') ? decodeURIComponent(payload) : payload) };
  const text = decodeURIComponent(payload);
  const bytes =
    typeof TextEncoder === 'function' ? new TextEncoder().encode(text) : Uint8Array.from(text, (c) => c.charCodeAt(0) & 0xff);
  return { mime, bytes };
}

export function readFiles(control: Control): string | null {
  const files = (control.el as HTMLInputElement).files;
  if (!files || files.length === 0) return null;
  return Array.from(files, (f) => f.name).join(', ');
}

export async function fillFile(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  if (intent.kind !== 'file') return failed(`unsupported intent for file input: ${intent.kind}`);
  const input = control.el as HTMLInputElement;
  const win = winOf(input);
  const { name, type, dataUrl } = intent.file;
  const parsed = parseDataUrl(dataUrl);
  const file = new win.File([parsed.bytes as BlobPart], name, { type: type || parsed.mime });

  const DT = (win as unknown as { DataTransfer?: new () => DataTransfer }).DataTransfer;
  let assigned = false;
  if (typeof DT === 'function') {
    try {
      const dt = new DT();
      dt.items.add(file);
      input.files = dt.files;
      assigned = input.files?.length === 1;
    } catch {
      assigned = false;
    }
  }
  if (!assigned) {
    // No DataTransfer (very old engines, jsdom): expose a FileList-shaped object on the instance.
    const list = Object.assign([file], { item: (i: number) => list[i] ?? null });
    Object.defineProperty(input, 'files', { configurable: true, get: () => list });
  }
  fireInput(input);
  fireChange(input);
  const ok = await settle(input, ctx, () => readFiles(control) === name);
  return ok ? { ok: true, observed: readFiles(control) } : failed('file was not attached', readFiles(control));
}
