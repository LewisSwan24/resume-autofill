import { afterEach, describe, expect, it } from 'vitest';
import { scanDocument } from '../../../src/engine/scan';
import { runFill } from '../../../src/fill/runFill';
import { createSampleProfile } from '../../../src/schema';

afterEach(() => {
  document.body.replaceChildren();
});

describe('native two-input dateRange control', () => {
  it('discovers .raf-date-range containers and fills both start and end inputs', async () => {
    document.body.innerHTML = `
      <form>
        <h2>教育经历</h2>
        <div>
          <label for="ed-start">就读时间</label>
          <div class="raf-date-range" data-raf-date-range>
            <input id="ed-start" type="month" placeholder="开始日期" />
            <span>-</span>
            <input id="ed-end" type="month" placeholder="结束日期" />
          </div>
        </div>
      </form>
    `;

    const scan = scanDocument(document);
    const rangeControl = scan.contexts.find((c) => c.control.dateRange);
    expect(rangeControl).toBeDefined();
    expect(rangeControl!.control.kind).toBe('date');

    const resume = structuredClone(createSampleProfile().resumes.find((r) => r.id === 'sample-zh')!);
    const out = await runFill(document, { resume, files: {} });
    const startVal = (document.getElementById('ed-start') as HTMLInputElement).value;
    const endVal = (document.getElementById('ed-end') as HTMLInputElement).value;
    expect(startVal).toBe(resume.education[0]!.startDate.slice(0, 7));
    expect(endVal).toBe((resume.education[0]!.endDate ?? '').slice(0, 7));
    const reportRow = out.report.fields.find((f) => f.fieldKey === 'education.period');
    expect(reportRow?.outcome).toBe('filled');
    expect(reportRow?.observed).toContain(startVal);
  });

  it('fills ongoing work period start date and leaves end input empty when current is true', async () => {
    document.body.innerHTML = `
      <form>
        <h2>工作经历</h2>
        <div>
          <label for="wk-start">起止时间</label>
          <div class="date-range">
            <input id="wk-start" type="month" placeholder="开始月份" />
            <input id="wk-end" type="month" placeholder="结束月份" />
          </div>
        </div>
      </form>
    `;

    const resume = structuredClone(createSampleProfile().resumes.find((r) => r.id === 'sample-zh')!);
    resume.work = [
      {
        kind: 'full_time',
        company: 'Acme',
        position: 'Engineer',
        department: '',
        city: 'Beijing',
        startDate: '2024-06',
        endDate: null,
        current: true,
        description: 'Backend',
      },
    ];
    await runFill(document, { resume, files: {} });
    expect((document.getElementById('wk-start') as HTMLInputElement).value).toBe('2024-06');
    expect((document.getElementById('wk-end') as HTMLInputElement).value).toBe('');
  });
});
