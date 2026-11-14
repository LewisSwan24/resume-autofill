// @vitest-environment node
// Files handed over by other apps: the native IncomingFile plugin's payload checked again on the JS side, and the
// subscription that takes the pending item at start and after every event.
import { describe, expect, it, vi } from 'vitest';
import {
  cleanFileName,
  createNativeIncomingSource,
  parseNativeIncoming,
  type IncomingEvent,
  type IncomingFilePlugin,
} from '../../../../mobile/app/src/resumeImport/incoming';
import { DOCX_MIME, IMPORT_MAX_BYTES, PDF_MIME } from '../../../../mobile/app/src/resumeImport/types';

const PDF_BYTES = new TextEncoder().encode('%PDF-1.7\n张三');
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');

function ready(over: Record<string, unknown> = {}) {
  return {
    state: 'ready',
    source: 'view',
    name: '示例简历.pdf',
    mimeType: PDF_MIME,
    size: PDF_BYTES.length,
    data: b64(PDF_BYTES),
    ...over,
  };
}

describe('parseNativeIncoming', () => {
  it('a ready PDF payload becomes a file event with its bytes, name and source', () => {
    const event = parseNativeIncoming(ready());
    expect(event?.kind).toBe('file');
    if (event?.kind !== 'file') return;
    expect(event.file.name).toBe('示例简历.pdf');
    expect(event.file.mimeType).toBe(PDF_MIME);
    expect(event.file.source).toBe('view');
    expect(event.file.stored).toBeUndefined();
    expect(Array.from(event.file.bytes)).toEqual(Array.from(PDF_BYTES));

    const docx = parseNativeIncoming(ready({ source: 'send', name: 'cv.docx', mimeType: DOCX_MIME }));
    expect(docx).toMatchObject({ kind: 'file', file: { source: 'send', name: 'cv.docx', mimeType: DOCX_MIME } });
  });

  it('a type other than PDF or .docx is wrong_type', () => {
    for (const mimeType of ['text/plain', 'application/msword', 'image/png', 'application/octet-stream']) {
      expect(parseNativeIncoming(ready({ mimeType, name: 'cv.txt' })), mimeType).toEqual({ kind: 'error', reason: 'wrong_type' });
    }
    expect(parseNativeIncoming(ready({ mimeType: '', name: 'cv.doc' }))).toEqual({ kind: 'error', reason: 'wrong_type' });
  });

  it('octet-stream with a .pdf name is taken as a PDF', () => {
    const event = parseNativeIncoming(ready({ mimeType: 'application/octet-stream', name: '简历.PDF' }));
    expect(event).toMatchObject({ kind: 'file', file: { mimeType: PDF_MIME, name: '简历.PDF' } });
    const word = parseNativeIncoming(ready({ mimeType: '', name: 'cv.docx' }));
    expect(word).toMatchObject({ kind: 'file', file: { mimeType: DOCX_MIME } });
  });

  it('data over 10 MB is too_large before it is decoded; zero bytes is empty', () => {
    const atob = vi.spyOn(globalThis, 'atob');
    try {
      // Longer than 10 MB once decoded; not even valid base64, so only the length check can answer.
      const huge = 'A'.repeat(Math.ceil(IMPORT_MAX_BYTES / 3) * 4 + 8);
      expect(parseNativeIncoming(ready({ data: huge, size: 1 }))).toEqual({ kind: 'error', reason: 'too_large' });
      expect(parseNativeIncoming(ready({ size: IMPORT_MAX_BYTES + 1 }))).toEqual({ kind: 'error', reason: 'too_large' });
      expect(atob).not.toHaveBeenCalled();
    } finally {
      atob.mockRestore();
    }
    expect(parseNativeIncoming(ready({ data: '', size: 0 }))).toEqual({ kind: 'error', reason: 'empty' });
  });

  it('bad base64 or a malformed payload is unreadable and never throws', () => {
    const unreadable = { kind: 'error', reason: 'unreadable' };
    expect(parseNativeIncoming(ready({ data: 'not base64!!' }))).toEqual(unreadable);
    expect(parseNativeIncoming(ready({ data: 'QUJD\nRA==' }))).toEqual(unreadable);
    expect(parseNativeIncoming(ready({ data: 42 }))).toEqual(unreadable);
    expect(parseNativeIncoming(ready({ source: 'picker' }))).toEqual(unreadable);
    expect(parseNativeIncoming(ready({ source: undefined }))).toEqual(unreadable);
    for (const raw of [undefined, 'ready', 7, [], { state: 'later' }, { nope: 1 }]) {
      expect(() => parseNativeIncoming(raw)).not.toThrow();
      expect(parseNativeIncoming(raw), JSON.stringify(raw)).toEqual(unreadable);
    }
    const hostile = {
      get state() {
        throw new Error('boom');
      },
    };
    expect(parseNativeIncoming(hostile)).toEqual(unreadable);
    expect(parseNativeIncoming({ state: 'error', reason: 'too_large' })).toEqual({ kind: 'error', reason: 'too_large' });
    expect(parseNativeIncoming({ state: 'error', reason: 'empty' })).toEqual({ kind: 'error', reason: 'empty' });
    expect(parseNativeIncoming({ state: 'error', reason: 'encrypted' })).toEqual(unreadable);
    expect(parseNativeIncoming({ state: 'reading', name: 'a/b/简历.pdf' })).toEqual({ kind: 'reading', name: '简历.pdf' });
    expect(parseNativeIncoming({ state: 'reading' })).toEqual({ kind: 'reading', name: '' });
  });

  it('names lose path parts, control and bidi characters, and are cut to 128 characters', () => {
    expect(cleanFileName('/storage/emulated/0/Download/简历.pdf')).toBe('简历.pdf');
    expect(cleanFileName('C:\\Users\\someone\\cv.pdf')).toBe('cv.pdf');
    expect(cleanFileName('  cv\u0000\u0007\n.pdf  ')).toBe('cv.pdf');
    expect(cleanFileName('fdp.\u202Egnp\u202C.pdf')).toBe('fdp.gnp.pdf');
    expect(cleanFileName('a\u200Bb\u2066c\u2069.pdf')).toBe('abc.pdf');
    expect(cleanFileName('x'.repeat(300))).toHaveLength(128);
    expect(cleanFileName('张'.repeat(200))).toBe('张'.repeat(128));
    expect(cleanFileName('folder/')).toBe('');
    expect(cleanFileName('\u202E\u0000')).toBe('');
    expect(cleanFileName(undefined)).toBe('');
    expect(cleanFileName(12)).toBe('');
    expect(parseNativeIncoming(ready({ name: 'x/\u202E示例.pdf' }))).toMatchObject({ file: { name: '示例.pdf' } });
  });

  it('nothing pending gives null', () => {
    expect(parseNativeIncoming({ state: 'none' })).toBeNull();
  });
});

/** A fake plugin whose take() results are released by hand, so the test controls the order. */
function fakePlugin() {
  const pending: Array<(value: unknown) => void> = [];
  let listener: ((data: unknown) => void) | null = null;
  const removed = vi.fn(async () => {
    listener = null;
  });
  const plugin: IncomingFilePlugin = {
    take: vi.fn(() => new Promise<unknown>((resolve) => pending.push(resolve))),
    addListener: vi.fn(async (_event: 'incomingFile', l: (data: unknown) => void) => {
      listener = l;
      return { remove: removed };
    }),
  };
  return {
    plugin,
    removed,
    fire: () => listener?.({ state: 'ready' }),
    hasListener: () => listener !== null,
    resolveNext: (value: unknown) => pending.shift()!(value),
    pendingCount: () => pending.length,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('createNativeIncomingSource', () => {
  it('subscribe takes the pending item at once, and again on every event, one take at a time', async () => {
    const fake = fakePlugin();
    const events: IncomingEvent[] = [];
    createNativeIncomingSource(fake.plugin).subscribe((e) => events.push(e));
    await flush();
    expect(fake.plugin.addListener).toHaveBeenCalledWith('incomingFile', expect.any(Function));
    expect(fake.plugin.take).toHaveBeenCalledTimes(1);

    // Two events while the first take is in flight: no second concurrent take, but one follows it.
    fake.fire();
    fake.fire();
    await flush();
    expect(fake.plugin.take).toHaveBeenCalledTimes(1);

    fake.resolveNext({ state: 'reading', name: '示例简历.pdf' });
    await flush();
    expect(events).toEqual([{ kind: 'reading', name: '示例简历.pdf' }]);
    expect(fake.plugin.take).toHaveBeenCalledTimes(2);

    fake.resolveNext(ready());
    await flush();
    expect(events[1]?.kind).toBe('file');
    // The two queued events folded into one follow-up take.
    expect(fake.plugin.take).toHaveBeenCalledTimes(2);

    fake.fire();
    await flush();
    expect(fake.plugin.take).toHaveBeenCalledTimes(3);
    fake.resolveNext({ state: 'none' });
    await flush();
    expect(events).toHaveLength(2);
  });

  it('a take that fails delivers nothing and does not stop later ones', async () => {
    const fake = fakePlugin();
    (fake.plugin.take as ReturnType<typeof vi.fn>).mockImplementationOnce(() => Promise.reject(new Error('x')));
    const events: IncomingEvent[] = [];
    createNativeIncomingSource(fake.plugin).subscribe((e) => events.push(e));
    await flush();
    expect(events).toEqual([]);
    fake.fire();
    await flush();
    fake.resolveNext({ state: 'error', reason: 'empty' });
    await flush();
    expect(events).toEqual([{ kind: 'error', reason: 'empty' }]);
  });

  it('unsubscribe removes the listener and ignores a take still in flight', async () => {
    const fake = fakePlugin();
    const handler = vi.fn();
    const off = createNativeIncomingSource(fake.plugin).subscribe(handler);
    await flush();
    expect(fake.pendingCount()).toBe(1);
    off();
    await flush();
    expect(fake.removed).toHaveBeenCalledTimes(1);
    expect(fake.hasListener()).toBe(false);
    fake.resolveNext(ready());
    await flush();
    expect(handler).not.toHaveBeenCalled();
  });

  it('unsubscribe before the listener is added still removes it once it is', async () => {
    const fake = fakePlugin();
    const off = createNativeIncomingSource(fake.plugin).subscribe(vi.fn());
    off();
    await flush();
    expect(fake.removed).toHaveBeenCalledTimes(1);
  });
});
