// runFill must survive exceptions in ensureCards and in executeStep (I3).
import { afterEach, describe, expect, it, vi } from 'vitest';
import * as executeModule from '../../../src/drivers/execute';
import * as ensureCardsModule from '../../../src/fill/ensureCards';
import { runFill } from '../../../src/fill/runFill';
import { clearHighlights } from '../../../src/fill/highlight';
import { createSampleFiles, createSampleProfile } from '../../../src/schema';

vi.mock('../../../src/fill/ensureCards', async (orig) => {
  const actual = await orig<typeof import('../../../src/fill/ensureCards')>();
  return { ...actual, ensureCards: vi.fn(actual.ensureCards) };
});
vi.mock('../../../src/drivers/execute', async (orig) => {
  const actual = await orig<typeof import('../../../src/drivers/execute')>();
  return { ...actual, executeStep: vi.fn(actual.executeStep) };
});

const zh = createSampleProfile().resumes.find((r) => r.id === 'sample-zh')!;
const files = createSampleFiles();
const ensureCards = vi.mocked(ensureCardsModule.ensureCards);
const executeStep = vi.mocked(executeModule.executeStep);
const realEnsure = ensureCards.getMockImplementation()!;
const realExecute = executeStep.getMockImplementation()!;

afterEach(() => {
  ensureCards.mockImplementation(realEnsure);
  executeStep.mockImplementation(realExecute);
  vi.restoreAllMocks();
  clearHighlights();
  document.body.innerHTML = '';
});

const mount = () => {
  document.body.innerHTML = `<form id="f">
    <h2>基本信息</h2>
    <div><label for="nm">姓名</label><input id="nm"><label for="em">电子邮箱</label><input id="em"></div>
  </form>`;
};
const value = (id: string) => (document.getElementById(id) as HTMLInputElement).value;

describe('runFill error isolation', () => {
  it('keeps filling with the existing cards when ensureCards throws', async () => {
    mount();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    ensureCards.mockRejectedValue(new Error('grow boom'));
    const { report, growth } = await runFill(document, { resume: zh, files });
    expect(growth).toEqual([]);
    expect(value('nm')).toBe('林知远');
    expect(value('em')).toBe('zhiyuan.lin@example.com');
    expect(report.counts.filled).toBeGreaterThanOrEqual(2);
  });

  it('turns an exception of one executeStep into an action_failed row and fills the rest', async () => {
    mount();
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let first = true;
    executeStep.mockImplementation(async (...args) => {
      if (first) {
        first = false;
        throw new Error('step boom');
      }
      return realExecute(...args);
    });
    const { report } = await runFill(document, { resume: zh, files });
    const failed = report.fields.filter((f) => f.outcome === 'action_failed');
    expect(failed).toHaveLength(1);
    expect(failed[0]).toMatchObject({ fieldKey: expect.any(String), value: expect.any(String) });
    expect(report.counts.filled).toBeGreaterThanOrEqual(1);
    expect(Object.values(report.counts).reduce((a, b) => a + b, 0)).toBe(report.fields.length);
  });

  it('a driver whose match() throws costs only its own field', async () => {
    mount();
    const { registerDriver, unregisterDriver } = await import('../../../src/drivers/registry');
    registerDriver({
      id: 'boom-match',
      lib: 'native',
      kinds: ['text'],
      match: (c) => {
        if (c.el.id === 'em') throw new Error('match boom');
        return false;
      },
      fill: async () => ({ ok: false, observed: null }),
      read: () => null,
    });
    try {
      const { report } = await runFill(document, { resume: zh, files });
      expect(report.fields.find((f) => f.label.includes('邮箱'))?.outcome).toBe('action_failed');
      expect(value('nm')).toBe('林知远');
    } finally {
      unregisterDriver('boom-match');
    }
  });
});