// A span of dates in one field, as Chinese forms mostly ask for it: 起止时间, on a range picker or in a plain box.
import { afterEach, describe, expect, it } from 'vitest';
import { expandFieldKeys } from '../../../src/engine/fieldDeps';
import { planFill } from '../../../src/engine/plan';
import { scanDocument } from '../../../src/engine/scan';
import { createSampleProfile } from '../../../src/schema/samples';
import type { Resume } from '../../../src/schema/resume';

afterEach(() => {
  document.body.replaceChildren();
});

function show(html: string): void {
  const doc = new DOMParser().parseFromString(`<body>${html}</body>`, 'text/html');
  document.body.replaceChildren(...Array.from(doc.body.childNodes).map((n) => document.adoptNode(n)));
}

function plan(html: string, change: (r: Resume) => void = () => undefined, id = 'sample-zh') {
  show(html);
  const { contexts, classifications } = scanDocument(document);
  const resume = structuredClone(createSampleProfile().resumes.find((x) => x.id === id)!);
  change(resume);
  return { contexts, ...planFill(contexts, classifications, resume, {}) };
}

const antdRange = (placeholders = ['开始月份', '结束月份']) =>
  `<div id="w" class="ant-picker ant-picker-range"><div class="ant-picker-input"><input id="p" placeholder="${placeholders[0]}"></div><div class="ant-picker-range-separator"></div><div class="ant-picker-input"><input placeholder="${placeholders[1]}"></div></div>`;
const elementRange = (type = 'monthrange') =>
  `<div id="w" class="el-date-editor el-date-editor--${type} el-input__wrapper el-range-editor"><input id="p" class="el-range-input" placeholder="开始"><span class="el-range-separator">-</span><input class="el-range-input" placeholder="结束"></div>`;
const part = (title: string, label: string, control: string) =>
  `<form><h2>${title}</h2><div><label for="p">${label}</label>${control}</div></form>`;

const SPANS: [string, string, string][] = [
  ['项目经历', 'projects.period', '2022-03 ~ 2022-06'],
];

describe('a range picker', () => {
  it.each([
    ['antd', antdRange()],
    ['element', elementRange()],
  ])('is a field of %s now, month by month', (_lib, control) => {
    show(part('项目经历', '起止时间', control));
    const { contexts } = scanDocument(document);
    expect(contexts).toHaveLength(1);
    expect(contexts[0]!.control.kind).toBe('date');
    expect(contexts[0]!.control.dateRange).toBe(true);
    expect(contexts[0]!.control.dateGranularity).toBe('month');
  });

  it('knows a range of days', () => {
    show(part('项目经历', '起止时间', elementRange('daterange')));
    expect(scanDocument(document).contexts[0]!.control.dateGranularity).toBe('day');
    show(part('项目经历', '起止时间', antdRange(['开始日期', '结束日期'])));
    expect(scanDocument(document).contexts[0]!.control.dateGranularity).toBe('day');
  });

  it('still leaves a range with a time of day in it alone', () => {
    const { steps } = plan(part('项目经历', '起止时间', elementRange('datetimerange')));
    expect(steps).toEqual([]);
  });

  it.each(SPANS)('takes both ends in %s', (title, key, display) => {
    const { steps } = plan(part(title, '起止时间', antdRange()));
    expect(steps.map((s) => s.fieldKey)).toEqual([key]);
    expect(steps[0]!.intent).toMatchObject({ kind: 'dateRange', display, start: { year: 2022, month: 3 }, end: { year: 2022, month: 6 } });
  });

  it('writes days when the picker wants days, the first of the month where the file has only months', () => {
    const { steps } = plan(part('项目经历', '起止时间', antdRange(['开始日期', '结束日期'])));
    expect(steps[0]!.intent).toMatchObject({ kind: 'dateRange', display: '2022-03-01 ~ 2022-06-01' });
  });

  it.each(['时间', '项目时间', '项目周期', '起止日期', '开始时间', '结束时间', '开始 - 结束'])('is the whole span however its label reads: %s', (label) => {
    const { steps } = plan(part('项目经历', label, antdRange()));
    expect(steps.map((s) => s.fieldKey)).toEqual(['projects.period']);
  });

  it.each([
    ['工作经历', 'work', '起止时间'],
    ['实习经历', 'work', '实习时间'],
    ['教育经历', 'education', '在校时间'],
    ['教育经历', 'education', '就读时间'],
    ['工作经历', 'work', '在职时间'],
    ['校园经历', 'campus', '任职时间'],
  ])('belongs to the part of the file it stands in: %s, %s', (title, module, label) => {
    const { steps, reports } = plan(part(title, label, antdRange()));
    const keys = [...steps.map((s) => s.fieldKey), ...reports.map((r) => r.fieldKey)];
    expect(keys).toEqual([`${module}.period`]);
  });

  it('asks about a job still going, which has no end date to give', () => {
    const { steps, reports } = plan(part('工作经历', '起止时间', antdRange()), (r) => {
      r.work = [{ ...r.work[0]!, startDate: '2024-03', endDate: '', current: true }];
    });
    expect(steps).toEqual([]);
    expect(reports[0]).toMatchObject({ fieldKey: 'work.period', outcome: 'needs_review' });
  });

  it('asks about a span with an end date it does not have', () => {
    const { steps, reports } = plan(part('工作经历', '起止时间', antdRange()), (r) => {
      r.work = [{ ...r.work[0]!, startDate: '2024-03', endDate: '', current: false }];
    });
    expect(steps).toEqual([]);
    expect(reports[0]).toMatchObject({ fieldKey: 'work.period', outcome: 'needs_review' });
  });

  it('has nothing to say with no start date', () => {
    const { steps, reports } = plan(part('工作经历', '起止时间', antdRange()), (r) => {
      r.work = [{ ...r.work[0]!, startDate: '', endDate: '2024-03', current: false }];
    });
    expect(steps).toEqual([]);
    expect(reports[0]).toMatchObject({ outcome: 'no_data' });
  });

  it('puts nothing but a span in it', () => {
    const { steps } = plan('<form><h2>基本信息</h2><div><label for="p">出生日期</label>' + antdRange() + '</div></form>');
    expect(steps).toEqual([]);
  });

  it('puts nothing in it outside a part of the file with spans, whatever it is called', () => {
    const { steps } = plan('<form><h2>求职意向</h2><div><label for="p">可到岗时间</label>' + antdRange() + '</div></form>');
    expect(steps).toEqual([]);
  });
});

describe('a plain box asking for a span', () => {
  const box = '<input id="p">';

  it('gets it written out in Chinese', () => {
    const { steps } = plan(part('项目经历', '起止时间', box));
    expect(steps[0]).toMatchObject({ fieldKey: 'projects.period', intent: { kind: 'text', text: '2022.03-2022.06' } });
  });

  it('says 至今 for a job still going', () => {
    const { steps } = plan(part('工作经历', '起止时间', box), (r) => {
      r.work = [{ ...r.work[0]!, startDate: '2024-03', endDate: '', current: true }];
    });
    expect(steps[0]).toMatchObject({ fieldKey: 'work.period', intent: { kind: 'text', text: '2024.03-至今' } });
  });

  it('says Present in English', () => {
    const { steps } = plan('<form><h2>Work experience</h2><div><label for="p">Dates of employment</label><input id="p"></div></form>', (r) => {
      r.work = [{ ...r.work[0]!, startDate: '2024-03', endDate: '', current: true }];
    }, 'sample-en');
    expect(steps[0]).toMatchObject({ fieldKey: 'work.period', intent: { kind: 'text', text: '2024-03 - Present' } });
  });

  it('leaves out a span with no end date and no word for it', () => {
    const { steps } = plan(part('工作经历', '起止时间', box), (r) => {
      r.work = [{ ...r.work[0]!, startDate: '2024-03', endDate: '', current: false }];
    });
    expect(steps).toEqual([]);
  });

  it('asks about a single date picker, which cannot hold one', () => {
    const { steps, reports } = plan(part('项目经历', '起止时间', '<input id="p" type="date">'));
    expect(steps).toEqual([]);
    expect(reports[0]).toMatchObject({ fieldKey: 'projects.period', outcome: 'needs_review' });
  });

  it('asks nothing of a dropdown', () => {
    const { steps } = plan(part('项目经历', '起止时间', '<select id="p"><option>2022</option></select>'));
    expect(steps).toEqual([]);
  });
});

describe('labels near a span that are not one', () => {
  const key = (title: string, label: string): string | undefined => plan(part(title, label, '<input id="p">')).steps[0]?.fieldKey;

  it.each(['参加工作时间', '首次工作时间', '工作时间要求', '开始时间', '结束时间'])('in 工作经历: %s', (label) => {
    expect(key('工作经历', label)).not.toBe('work.period');
  });

  it('fills no span from a label with no part of the file around it', () => {
    const { steps } = plan('<form><label for="p">起止时间</label><input id="p"></form>');
    expect(steps).toEqual([]);
  });
});

describe('what a frame is sent for a span', () => {
  it('is what it is worked out from', () => {
    expect([...expandFieldKeys(['work.period'])].sort()).toEqual(['work.current', 'work.endDate', 'work.period', 'work.startDate']);
  });
});
