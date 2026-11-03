import { expect, test, type Frame, type Page } from '@playwright/test';
import { execIntent, fixtureState, injectHarness, findControlByLabel } from './helpers';

const PDF_DATA_URL = `data:application/pdf;base64,${Buffer.from('%PDF-1.4 fixture').toString('base64')}`;

let page: Page;

test.beforeEach(async ({ page: p }) => {
  page = p;
  await page.goto('/native/');
  await injectHarness(page);
});

async function innerFrame(): Promise<Frame> {
  const frame = page.frames().find((f) => f.url().endsWith('/native/frame.html'));
  if (!frame) throw new Error('fixture iframe not found');
  await frame.waitForLoadState('domcontentloaded');
  await injectHarness(frame);
  return frame;
}

test.describe('native driver on the native fixture', () => {
  test('harness exposes the documented API and locates controls by label', async () => {
    const api = await page.evaluate(() => Object.keys(window.__raf).sort());
    expect(api).toEqual(
      expect.arrayContaining(['discover', 'buildFieldContext', 'getDriver', 'executeStep', 'samples', 'locate', 'execIntent']),
    );
    const { id, kind } = await findControlByLabel(page, 'First name');
    expect(kind).toBe('text');
    expect(id).toMatch(/^c\d+$/);
  });

  test('text input', async () => {
    const report = await execIntent(page, 'First name', { kind: 'text', text: 'Zhiyuan' });
    expect(report).toMatchObject({ outcome: 'filled', observed: 'Zhiyuan' });
    expect((await fixtureState(page)).firstName).toBe('Zhiyuan');
  });

  test('textarea inside an employment card', async () => {
    const text = 'Cleaned and analysed business metrics and built daily monitoring dashboards.';
    const report = await execIntent(page, 'Description', { kind: 'text', text });
    expect(report).toMatchObject({ outcome: 'filled', observed: text });
    expect((await fixtureState(page))['employment[0].description']).toBe(text);
  });

  test('select (exact label match)', async () => {
    const report = await execIntent(page, 'State', { kind: 'choice', display: 'QLD', query: 'QLD' });
    expect(report).toMatchObject({ outcome: 'filled', observed: 'QLD' });
    expect((await fixtureState(page)).state).toBe('QLD');
  });

  test('select with matchLabel different from the query', async () => {
    const report = await execIntent(page, 'Pronouns', {
      kind: 'choice',
      display: 'he',
      query: 'he',
      options: { matchLabel: 'He/him' },
    });
    expect(report).toMatchObject({ outcome: 'filled', observed: 'He/him' });
    expect((await fixtureState(page)).pronouns).toBe('He/him');
  });

  test('radio group', async () => {
    const report = await execIntent(page, 'Will you now or in the future require sponsorship?', {
      kind: 'choice',
      display: 'No',
      query: 'No',
    });
    expect(report).toMatchObject({ outcome: 'filled', observed: 'No' });
    expect((await fixtureState(page)).requiresSponsorship).toBe('No');
  });

  test('single checkbox (check, then uncheck)', async () => {
    const on = await execIntent(page, 'I currently work here', { kind: 'check', checked: true });
    expect(on).toMatchObject({ outcome: 'filled', observed: 'true' });
    expect((await fixtureState(page))['employment[0].current']).toBe(true);
    const off = await execIntent(page, 'I currently work here', { kind: 'check', checked: false });
    expect(off).toMatchObject({ outcome: 'filled', observed: 'false' });
    expect((await fixtureState(page))['employment[0].current']).toBe(false);
  });

  test('date input', async () => {
    const report = await execIntent(page, 'Visa expiry date', {
      kind: 'date',
      display: '2028-08-31',
      year: 2028,
      month: 8,
      day: 31,
    });
    expect(report).toMatchObject({ outcome: 'filled', observed: '2028-08-31' });
    expect((await fixtureState(page)).visaExpiry).toBe('2028-08-31');
  });

  test('month input in the education table (header-only label)', async () => {
    const report = await execIntent(
      page,
      'Start',
      { kind: 'date', display: '2024-07', year: 2024, month: 7 },
      { nth: 0 },
    );
    expect(report).toMatchObject({ outcome: 'filled', observed: '2024-07' });
    expect((await fixtureState(page))['education[0].start']).toBe('2024-07');
  });

  test('file input', async () => {
    const report = await execIntent(page, 'Resume/CV', {
      kind: 'file',
      file: { name: 'Zhiyuan-Lin-Resume.pdf', type: 'application/pdf', dataUrl: PDF_DATA_URL },
    });
    expect(report).toMatchObject({ outcome: 'filled', observed: 'Zhiyuan-Lin-Resume.pdf' });
    expect((await fixtureState(page)).resume).toEqual(['Zhiyuan-Lin-Resume.pdf']);
  });

  test('contenteditable editor', async () => {
    const text = 'I am a Master of Computer Science student looking for a graduate role in Brisbane.';
    const report = await execIntent(page, 'Tell us about yourself', { kind: 'text', text });
    expect(report).toMatchObject({ outcome: 'filled', observed: text });
    expect((await fixtureState(page)).aboutYou).toBe(text);
  });

  test('controls inside the same-origin iframe', async () => {
    const frame = await innerFrame();
    const text = await execIntent(frame, 'Notice period', { kind: 'text', text: '2 weeks' });
    expect(text).toMatchObject({ outcome: 'filled', observed: '2 weeks' });
    const month = await execIntent(frame, 'Earliest start date', { kind: 'date', display: '2026-07', year: 2026, month: 7 });
    expect(month).toMatchObject({ outcome: 'filled', observed: '2026-07' });
    const state = await fixtureState(page);
    expect(state['frame.noticePeriod']).toBe('2 weeks');
    expect(state['frame.earliestStartDate']).toBe('2026-07');
  });

  test('negative: choice without a matching option → no_option, state unchanged', async () => {
    const before = await fixtureState(page);
    const report = await execIntent(page, 'Preferred location', {
      kind: 'choice',
      display: 'Hobart',
      query: 'Hobart',
    });
    expect(report.outcome).toBe('no_option');
    expect(report.observed ?? null).toBeNull();
    expect(await fixtureState(page)).toEqual(before);
    expect(before.preferredLocation).toBe('');
  });
});
