import { describe, expect, it } from 'vitest';
import { checkInbound, createReplyBook, initialFrames, newGeneration, removeFrame, unreachableCount, type FramesState } from '../../../../mobile/app/src/browser/model/frames';
import { encode } from '../../../../mobile/bridge/protocol';

const ORIGIN = 'https://jobs.example.com';
const msg = (frame: number, data: unknown, extra: Partial<{ generation: number; origin: string; main: boolean }> = {}) => ({
  frame,
  generation: extra.generation ?? 1,
  origin: extra.origin ?? ORIGIN,
  main: extra.main ?? frame === 0,
  data: typeof data === 'string' ? data : JSON.stringify(data),
});
const hello = (iframes = 0) => ({ v: 1, kind: 'hello', iframes });
const scan = (count: number, iframes = 0) => ({ v: 1, kind: 'scan', count, iframes });

function feed(state: FramesState, ...events: ReturnType<typeof msg>[]): FramesState {
  for (const e of events) state = checkInbound(state, e).state;
  return state;
}

describe('frame registry (inbound checks)', () => {
  it('a hello registers the frame with its origin and main flag; a second hello is ignored', () => {
    let s = initialFrames(1);
    const first = checkInbound(s, msg(0, hello(2)));
    expect(first.message?.kind).toBe('hello');
    s = first.state;
    expect(s.frames).toEqual([{ frame: 0, origin: ORIGIN, main: true, count: 0, iframes: 2, incompatible: false, scanned: false }]);
    const again = checkInbound(s, msg(0, hello(5)));
    expect(again.message).toBeNull();
    expect(again.state.frames[0]!.iframes).toBe(2);
  });

  it('a scan from an unregistered frame is dropped', () => {
    const r = checkInbound(initialFrames(1), msg(3, scan(4), { main: false }));
    expect(r.message).toBeNull();
    expect(r.state.frames).toEqual([]);
  });

  it('a scan from a registered frame updates its count', () => {
    const s = feed(initialFrames(1), msg(0, hello()), msg(0, scan(7, 1)));
    expect(s.frames[0]).toMatchObject({ count: 7, iframes: 1, scanned: true });
  });

  it('a scan keeps the step the main frame names, even when its count is unchanged', () => {
    const s = feed(initialFrames(1), msg(0, hello()), msg(0, { ...scan(6), step: '基本信息' }), msg(0, { ...scan(6), step: '教育经历' }));
    expect(s.frames[0]).toMatchObject({ count: 6, step: '教育经历' });
  });

  it('drops a message whose origin differs from the registered one, or whose main flag changed', () => {
    const s = feed(initialFrames(1), msg(0, hello()));
    expect(checkInbound(s, msg(0, scan(3), { origin: 'https://evil.example.com' })).message).toBeNull();
    expect(checkInbound(s, msg(0, scan(3), { main: false })).message).toBeNull();
  });

  it.each(['null', 'file://', 'about:blank', 'content://x', 'garbage'])('drops origin %s', (origin) => {
    const r = checkInbound(initialFrames(1), msg(0, hello(), { origin }));
    expect(r.message).toBeNull();
    expect(r.state.frames).toEqual([]);
  });

  it('drops an old generation; a new generation clears every frame', () => {
    let s = feed(initialFrames(1), msg(0, hello()));
    expect(checkInbound(s, msg(1, hello(), { generation: 0, main: false })).message).toBeNull();
    s = newGeneration(s, 2);
    expect(s).toEqual({ generation: 2, frames: [] });
    expect(checkInbound(s, msg(0, scan(1))).message).toBeNull();
  });

  it('the 33rd frame is not registered; a second main hello is ignored', () => {
    let s = initialFrames(1);
    for (let i = 0; i < 32; i++) s = feed(s, msg(i, hello(), { main: i === 0 }));
    expect(s.frames).toHaveLength(32);
    expect(checkInbound(s, msg(40, hello(), { main: false })).message).toBeNull();
    const two = feed(initialFrames(1), msg(0, hello()));
    const r = checkInbound(two, msg(5, hello(), { main: true }));
    expect(r.message).toBeNull();
    expect(r.state.frames).toHaveLength(1);
  });

  it('a hello with v: 2 marks the frame incompatible and it counts as unreachable', () => {
    let s = feed(initialFrames(1), msg(0, hello(1)));
    const r = checkInbound(s, msg(4, { v: 2, kind: 'hello', iframes: 0 }, { main: false }));
    expect(r.message).toBeNull();
    s = r.state;
    expect(s.frames.find((f) => f.frame === 4)?.incompatible).toBe(true);
    expect(unreachableCount(s)).toBe(1);
    // and it cannot talk afterwards
    expect(checkInbound(s, msg(4, scan(3), { main: false })).message).toBeNull();
  });

  it('unreachable = iframes reported − sub-frames checked in, never negative', () => {
    let s = feed(initialFrames(1), msg(0, hello(3)));
    expect(unreachableCount(s)).toBe(3);
    s = feed(s, msg(1, hello(), { main: false, origin: 'https://other.example.com' }));
    expect(unreachableCount(s)).toBe(2);
    s = feed(s, msg(2, hello(), { main: false }), msg(3, hello(), { main: false }), msg(4, hello(), { main: false }));
    expect(unreachableCount(s)).toBe(0);
  });

  it('obstacles are accepted only from the main frame', () => {
    const ob = { v: 1, kind: 'obstacles', boxes: [], viewport: { width: 360, height: 600, offsetLeft: 0, offsetTop: 0, scale: 1 } };
    const s = feed(initialFrames(1), msg(0, hello()), msg(1, hello(), { main: false }));
    expect(checkInbound(s, msg(0, ob)).message?.kind).toBe('obstacles');
    expect(checkInbound(s, msg(1, ob, { main: false })).message).toBeNull();
  });

  it('bye and frameGone remove the frame', () => {
    let s = feed(initialFrames(1), msg(0, hello()), msg(1, hello(), { main: false }));
    s = feed(s, msg(1, { v: 1, kind: 'bye' }, { main: false }));
    expect(s.frames.map((f) => f.frame)).toEqual([0]);
    s = removeFrame(s, 0, 1);
    expect(s.frames).toEqual([]);
    expect(removeFrame(s, 0, 9)).toBe(s);
  });
});

describe('reply book', () => {
  const reply = (data: object) => JSON.parse(encode(data as never));

  it('matches a reply to its outstanding request once, from the same frame only', async () => {
    const book = createReplyBook();
    const wait = book.wait(2, 'r1', 'focus');
    expect(book.settle(3, reply({ v: 1, kind: 'focused', reqId: 'r1', ok: true }))).toBe(false);
    expect(book.settle(2, reply({ v: 1, kind: 'focused', reqId: 'other', ok: true }))).toBe(false);
    expect(book.settle(2, reply({ v: 1, kind: 'needs', reqId: 'r1', needs: { fieldKeys: [], repeatSections: [], attachmentKeys: [] } }))).toBe(false);
    expect(book.settle(2, reply({ v: 1, kind: 'focused', reqId: 'r1', ok: true }))).toBe(true);
    expect(book.settle(2, reply({ v: 1, kind: 'focused', reqId: 'r1', ok: false }))).toBe(false);
    await expect(wait).resolves.toMatchObject({ kind: 'focused', ok: true });
  });

  it('an error reply settles a fill; cancelAll resolves the rest with null', async () => {
    const book = createReplyBook();
    const fill = book.wait(0, 'a', 'fill');
    const undo = book.wait(0, 'b', 'undo');
    book.settle(0, reply({ v: 1, kind: 'error', reqId: 'a', code: 'fill_failed' }));
    await expect(fill).resolves.toMatchObject({ kind: 'error' });
    book.cancelAll();
    await expect(undo).resolves.toBeNull();
  });
});
