import { describe, expect, it } from 'vitest';
import {
  MAX_PAGE_MESSAGE_CHARS,
  PROTOCOL_VERSION,
  decodeAppCommand,
  decodePageMessage,
  encode,
} from '../../../../mobile/bridge/protocol';
import { ResumeSchema } from '../../../../src/schema';

const counts = { filled: 1, needs_review: 0, no_option: 0, unmatched: 0, action_failed: 0, no_data: 0, no_control: 0 };
const row = (i: number, label = '姓名') => ({
  fieldId: `c${i}`,
  label,
  fieldKey: 'basics.fullName',
  section: 'basics',
  outcome: 'filled',
  confidence: 0.9,
  value: '张三',
});
const report = (fields = [row(1)]) => ({ url: 'https://jobs.example.com/apply', startedAt: 1, finishedAt: 2, fields, counts });

const valid: Record<string, unknown> = {
  hello: { v: 1, kind: 'hello', iframes: 2 },
  scan: { v: 1, kind: 'scan', count: 12, iframes: 0 },
  needs: { v: 1, kind: 'needs', reqId: 'r1', needs: { fieldKeys: ['basics.fullName'], repeatSections: ['education'], attachmentKeys: [] } },
  report: { v: 1, kind: 'report', reqId: 'r2', runId: 'run1', report: report() },
  focused: { v: 1, kind: 'focused', reqId: 'r3', ok: true },
  undone: { v: 1, kind: 'undone', reqId: 'r4', runId: 'run1', restored: ['c1'], manual: [], addedCards: 1 },
  obstacles: {
    v: 1,
    kind: 'obstacles',
    boxes: [{ left: 0, top: 600, right: 360, bottom: 664 }],
    viewport: { width: 360, height: 664, offsetLeft: 0, offsetTop: 0, scale: 1 },
  },
  error: { v: 1, kind: 'error', reqId: 'r5', code: 'fill_failed' },
  bye: { v: 1, kind: 'bye' },
  step: {
    v: 1,
    kind: 'step',
    reqId: 'r6',
    state: { url: 'https://jobs.example.com/apply#2', fingerprint: 'fields:3:abc', action: 'next', blocker: null, userInputAt: 0, title: '教育经历' },
  },
  pressed: { v: 1, kind: 'pressed', reqId: 'r7', pressed: false, reason: 'final_step' },
};

describe('decodePageMessage', () => {
  for (const [kind, msg] of Object.entries(valid)) {
    it(`accepts a valid ${kind}`, () => {
      const out = decodePageMessage(JSON.stringify(msg));
      expect(out?.kind).toBe(kind);
    });
  }

  it('accepts a report row whose card was the page’s own entry already', () => {
    const held = { ...row(1), outcome: 'no_data', note: 'entry_held' };
    const out = decodePageMessage(JSON.stringify({ ...(valid.report as object), report: report([held]) }));
    expect(out?.kind === 'report' && out.report.fields[0]?.note).toBe('entry_held');
  });

  it('accepts a report that says which entry each row belongs to, what became of each entry, and a picked name', () => {
    const picked = { ...row(1), outcome: 'needs_review', note: 'picked_other_name', entry: 0, value: '星河示例理工大学', observed: '星河理工' };
    const entries = [
      { section: 'education', index: 0, state: 'existing', label: '星河示例理工大学' },
      { section: 'internship', index: 1, state: 'skipped', reason: 'add_failed', button: '添加实习经历' },
    ];
    const out = decodePageMessage(JSON.stringify({ ...(valid.report as object), report: { ...report([picked]), entries } }));
    expect(out?.kind === 'report' && out.report.fields[0]).toMatchObject({ note: 'picked_other_name', entry: 0 });
    expect(out?.kind === 'report' && out.report.entries).toEqual(entries);
  });

  it('drops a report with an entry in an unknown state', () => {
    const entries = [{ section: 'education', index: 0, state: 'lost' }];
    expect(decodePageMessage(JSON.stringify({ ...(valid.report as object), report: { ...report(), entries } }))).toBeNull();
  });

  it('accepts report rows for a sensitive field held back or filled by choice', () => {
    const held = { ...row(1), outcome: 'needs_review', note: 'sensitive_held' };
    const filled = { ...row(2), outcome: 'filled', note: 'sensitive_filled' };
    const out = decodePageMessage(JSON.stringify({ ...(valid.report as object), report: report([held, filled]) }));
    expect(out?.kind === 'report' && out.report.fields.map((f) => f.note)).toEqual(['sensitive_held', 'sensitive_filled']);
  });

  it('accepts a report row left for a day the resume does not hold', () => {
    const date = { ...row(1), outcome: 'needs_review', note: 'day_missing', value: '2021-09' };
    const out = decodePageMessage(JSON.stringify({ ...(valid.report as object), report: report([date]) }));
    expect(out?.kind === 'report' && out.report.fields[0]?.note).toBe('day_missing');
  });

  it('drops a step whose action or blocker it does not know, and a pressed with an unknown reason', () => {
    const step = valid.step as { state: object };
    expect(decodePageMessage(JSON.stringify({ ...step, state: { ...step.state, action: 'jump' } }))).toBeNull();
    expect(decodePageMessage(JSON.stringify({ ...step, state: { ...step.state, blocker: 'later' } }))).toBeNull();
    expect(decodePageMessage(JSON.stringify({ ...(valid.pressed as object), reason: 'whatever' }))).toBeNull();
  });

  it('keeps only known needs keys and drops a message with an unknown field key', () => {
    const bad = { ...(valid.needs as object), needs: { fieldKeys: ['basics.nope'], repeatSections: [], attachmentKeys: [] } };
    expect(decodePageMessage(JSON.stringify(bad))).toBeNull();
  });

  it.each([
    ['not JSON', '{nope'],
    ['not an object', '"hello"'],
    ['an array', '[1]'],
    ['v: 2', JSON.stringify({ ...(valid.hello as object), v: 2 })],
    ['missing v', JSON.stringify({ kind: 'hello', iframes: 0 })],
    ['unknown kind', JSON.stringify({ v: 1, kind: 'gimme' })],
    ['an extra property', JSON.stringify({ ...(valid.hello as object), extra: 1 })],
    ['count -1', JSON.stringify({ v: 1, kind: 'scan', count: -1, iframes: 0 })],
    ['1001 report rows', JSON.stringify({ ...(valid.report as object), report: report(Array.from({ length: 1001 }, (_, i) => row(i))) })],
    ['a label of 301 chars', JSON.stringify({ ...(valid.report as object), report: report([row(1, 'x'.repeat(301))]) })],
    ['an unknown outcome', JSON.stringify({ ...(valid.report as object), report: report([{ ...row(1), outcome: 'great' }]) })],
  ])('drops %s', (_name, text) => {
    expect(decodePageMessage(text)).toBeNull();
  });

  it('drops a string longer than MAX_PAGE_MESSAGE_CHARS', () => {
    const text = JSON.stringify({ v: 1, kind: 'hello', iframes: 0 }) + ' '.repeat(MAX_PAGE_MESSAGE_CHARS);
    expect(decodePageMessage(text)).toBeNull();
  });

  it('never throws on odd input', () => {
    for (const x of [undefined, null, 42, {}, 'null', 'true', '{"v":1}']) {
      expect(() => decodePageMessage(x as unknown as string)).not.toThrow();
      expect(decodePageMessage(x as unknown as string)).toBeNull();
    }
  });
});

describe('decodeAppCommand', () => {
  const resume = ResumeSchema.parse({ id: 'r', title: '', locale: 'zh-CN', basics: { familyName: '张', givenName: '三' } });
  const file = { name: 'cv.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,AAAA' };
  const commands: Record<string, unknown> = {
    needs: { v: 1, kind: 'needs', reqId: 'q1' },
    fill: { v: 1, kind: 'fill', reqId: 'q2', runId: 'run1', origin: 'https://jobs.example.com', resume, files: { f1: file } },
    focus: { v: 1, kind: 'focus', reqId: 'q3', fieldId: 'c1' },
    undo: { v: 1, kind: 'undo', reqId: 'q4', runId: 'run1' },
    clear: { v: 1, kind: 'clear' },
    step: { v: 1, kind: 'step', reqId: 'q5' },
    press: { v: 1, kind: 'press', reqId: 'q6' },
  };

  it('a fill may say to write sensitive fields and to fill only some fields', () => {
    const cmd = decodeAppCommand(JSON.stringify({ ...(commands.fill as object), sensitiveFields: 'fill', only: ['c1'] }));
    expect(cmd?.kind === 'fill' && [cmd.sensitiveFields, cmd.only]).toEqual(['fill', ['c1']]);
    expect(decodeAppCommand(JSON.stringify({ ...(commands.fill as object), sensitiveFields: 'always' }))).toBeNull();
  });

  for (const [kind, cmd] of Object.entries(commands)) {
    it(`accepts ${kind}`, () => {
      expect(decodeAppCommand(JSON.stringify(cmd))?.kind).toBe(kind);
    });
  }

  it('drops a fill whose resume fails ResumeSchema', () => {
    const bad = { ...(commands.fill as object), resume: { id: '', locale: 'xx' } };
    expect(decodeAppCommand(JSON.stringify(bad))).toBeNull();
  });

  it('drops a fill with 4 files', () => {
    const bad = { ...(commands.fill as object), files: { a: file, b: file, c: file, d: file } };
    expect(decodeAppCommand(JSON.stringify(bad))).toBeNull();
  });

  it('drops a file whose dataUrl does not start with data:', () => {
    const bad = { ...(commands.fill as object), files: { a: { ...file, dataUrl: 'https://example.com/x.pdf' } } };
    expect(decodeAppCommand(JSON.stringify(bad))).toBeNull();
  });

  it('drops a command with v: 2', () => {
    expect(decodeAppCommand(JSON.stringify({ v: 2, kind: 'clear' }))).toBeNull();
  });
});

describe('encode', () => {
  it('round-trips page messages and app commands', () => {
    expect(PROTOCOL_VERSION).toBe(1);
    for (const msg of Object.values(valid)) {
      const text = encode(msg as never);
      expect(decodePageMessage(text)).toEqual(msg);
    }
    const cmd = { v: 1 as const, kind: 'focus' as const, reqId: 'q', fieldId: 'c2' };
    expect(decodeAppCommand(encode(cmd))).toEqual(cmd);
  });
});
