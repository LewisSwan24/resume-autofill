// What the IncomingIntent plugin hands over is checked before anything acts on it.
import { describe, expect, it } from 'vitest';
import { createIncomingLinkSource, parseIncomingIntent, type IncomingLinkEvent } from '../../../../mobile/app/src/incoming/events';
import { createFakeIncomingIntent, type IncomingIntentPlugin } from '../../../../mobile/app/src/native/incomingIntent';

/** RIGHT-TO-LEFT OVERRIDE, built at run time so no source file carries the character. */
const RLO = String.fromCharCode(0x202e);
const ready = (rest: Record<string, unknown>) => ({ state: 'ready', ...rest });

describe('parseIncomingIntent', () => {
  it('each kind parses', () => {
    expect(parseIncomingIntent(ready({ kind: 'view', url: 'https://jobs.example.com/a' }))).toEqual({ kind: 'view', url: 'https://jobs.example.com/a' });
    expect(parseIncomingIntent(ready({ kind: 'text', text: '网申入口 https://jobs.example.com', subject: '示例科技', cut: false }))).toEqual({
      kind: 'text',
      text: '网申入口 https://jobs.example.com',
      subject: '示例科技',
      cut: false,
    });
    expect(parseIncomingIntent(ready({ kind: 'text', text: 'x', cut: true }))).toEqual({ kind: 'text', text: 'x', cut: true });
    expect(parseIncomingIntent(ready({ kind: 'paste' }))).toEqual({ kind: 'paste' });
    expect(parseIncomingIntent(ready({ kind: 'demo' }))).toEqual({ kind: 'demo' });
    expect(parseIncomingIntent(ready({ kind: 'application', recordId: 'ab-12', open: 'detail' }))).toEqual({
      kind: 'application',
      recordId: 'ab-12',
      open: 'detail',
    });
    expect(parseIncomingIntent(ready({ kind: 'application', recordId: 'ab-12', open: 'page' }))).toMatchObject({ open: 'page' });
    // A notification's 打开网申页面; any other value of `from` is ignored.
    expect(parseIncomingIntent(ready({ kind: 'application', recordId: 'ab-12', open: 'page', from: 'reminder' }))).toEqual({
      kind: 'application',
      recordId: 'ab-12',
      open: 'page',
      from: 'reminder',
    });
    expect(parseIncomingIntent(ready({ kind: 'application', recordId: 'ab-12', open: 'page', from: 'other' }))).toEqual({
      kind: 'application',
      recordId: 'ab-12',
      open: 'page',
    });
    expect(parseIncomingIntent(ready({ kind: 'refused', reason: 'scheme' }))).toEqual({ kind: 'refused', reason: 'scheme' });
    expect(parseIncomingIntent(ready({ kind: 'refused', reason: 'too_long' }))).toEqual({ kind: 'refused', reason: 'too_long' });
  });

  it('malformed payloads give null', () => {
    for (const raw of [
      null,
      undefined,
      'view',
      42,
      { state: 'none' },
      ready({}),
      ready({ kind: 'nope' }),
      { kind: 'view', url: 'https://jobs.example.com' },
      ready({ kind: 'view' }),
      ready({ kind: 'view', url: 7 }),
      ready({ kind: 'text', cut: false }),
      ready({ kind: 'text', text: 'x', cut: 'yes' }),
      ready({ kind: 'refused', reason: 'other' }),
    ]) {
      expect(parseIncomingIntent(raw)).toBeNull();
    }
  });

  it('over-long text, bad ids and unknown open values are refused', () => {
    expect(parseIncomingIntent(ready({ kind: 'view', url: `https://jobs.example.com/${'a'.repeat(4096)}` }))).toBeNull();
    expect(parseIncomingIntent(ready({ kind: 'text', text: '链'.repeat(8193), cut: true }))).toBeNull();
    // 8192 code points of an astral character is 16384 UTF-16 units and still allowed.
    expect(parseIncomingIntent(ready({ kind: 'text', text: '😀'.repeat(8192), cut: true }))).not.toBeNull();
    for (const recordId of ['', 'a b', 'a/b', '../x', 'x'.repeat(65), 7]) {
      expect(parseIncomingIntent(ready({ kind: 'application', recordId, open: 'page' }))).toBeNull();
    }
    expect(parseIncomingIntent(ready({ kind: 'application', recordId: 'ok-1', open: 'edit' }))).toBeNull();
    expect(parseIncomingIntent(ready({ kind: 'application', recordId: 'ok-1' }))).toBeNull();
    // A subject is cleaned and cut, never a reason to drop the text.
    const e = parseIncomingIntent(ready({ kind: 'text', text: 'x', subject: `示例\u0000科技${RLO}${'长'.repeat(300)}`, cut: false }));
    expect(e).toMatchObject({ kind: 'text' });
    const subject = (e as Extract<IncomingLinkEvent, { kind: 'text' }>).subject!;
    expect(subject.startsWith('示例科技')).toBe(true);
    expect(subject.length).toBeLessThanOrEqual(200);
    expect(/[\u0000-\u001f]/.test(subject) || subject.includes(RLO)).toBe(false);
    expect(parseIncomingIntent(ready({ kind: 'text', text: 'x', subject: 9, cut: false }))).toEqual({ kind: 'text', text: 'x', cut: false });
  });
});

describe('createIncomingLinkSource', () => {
  const flush = async () => {
    for (let i = 0; i < 5; i += 1) await Promise.resolve();
  };

  it('the source takes once at subscribe and once per event, one at a time', async () => {
    const plugin = createFakeIncomingIntent();
    plugin.deliver(ready({ kind: 'view', url: 'https://jobs.example.com/cold' }));
    const seen: IncomingLinkEvent[] = [];
    const stop = createIncomingLinkSource(plugin).subscribe((e) => seen.push(e));
    await flush();
    expect(plugin.takes).toBe(1);
    expect(seen).toEqual([{ kind: 'view', url: 'https://jobs.example.com/cold' }]);

    plugin.deliver(ready({ kind: 'demo' }));
    await flush();
    expect(plugin.takes).toBe(2);
    expect(seen.at(-1)).toEqual({ kind: 'demo' });

    stop();
    plugin.deliver(ready({ kind: 'paste' }));
    await flush();
    expect(plugin.takes).toBe(2);
    expect(seen).toHaveLength(2);
  });

  it('events during a take fold into one more take after it', async () => {
    let release!: () => void;
    let inFlight = 0;
    let maxInFlight = 0;
    let takes = 0;
    let listener: () => void = () => {};
    const plugin: IncomingIntentPlugin = {
      async take() {
        takes += 1;
        inFlight += 1;
        maxInFlight = Math.max(maxInFlight, inFlight);
        if (takes === 1) await new Promise<void>((r) => (release = r));
        inFlight -= 1;
        return { state: 'none' };
      },
      async addListener(_e, l) {
        listener = l;
        return { remove: async () => {} };
      },
    };
    createIncomingLinkSource(plugin).subscribe(() => {});
    await flush();
    expect(takes).toBe(1);
    listener();
    listener();
    listener();
    await flush();
    expect(takes).toBe(1);
    release();
    await flush();
    expect(takes).toBe(2);
    expect(maxInFlight).toBe(1);
  });
});
