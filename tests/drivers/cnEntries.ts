// The entries every Chinese portal's sections are filled with in the driver tests, all made up: two schools, two
// internships (the later still going), one project and one award.
import type { Page } from '@playwright/test';

export const ENTRIES = {
  education: [
    { school: '示例大学', degree: 'bachelor', major: '示例工程', startDate: '2019-09', endDate: '2023-06', current: false },
    { school: '示例研究院', degree: 'master', major: '示例科学', startDate: '2023-09', endDate: '2026-06', current: false },
  ],
  work: [
    { kind: 'internship', company: '示例科技有限公司', position: '示例实习生', startDate: '2022-07', endDate: '2022-09', current: false, description: '示例工作内容一。' },
    { kind: 'internship', company: '样例数据有限公司', position: '样例分析实习生', startDate: '2025-10', endDate: null, current: true, description: '示例工作内容二。' },
  ],
  projects: [{ name: '示例项目', role: '负责人', startDate: '2021-03', endDate: '2021-06', current: false, description: '示例项目描述。' }],
  awards: [{ name: '示例奖学金', date: '2021-10', level: 'school' }],
};

export interface EntryRow {
  outcome: string;
  fieldKey: string | null;
  label: string;
  /** Why a row waits for the applicant: `draft` for a long answer drafted for the side panel. */
  note?: string;
}

/** Fills the page from the Chinese sample resume with its entries swapped for ENTRIES, `runs` times. */
export function fillEntries(page: Page, runs = 1): Promise<EntryRow[]> {
  return page.evaluate(
    async ({ entries, runs }) => {
      const raf = window.__raf;
      const sample = structuredClone(raf.samples.resumes.find((r) => r.locale === 'zh-CN')!);
      const pick = <T,>(base: T, list: Record<string, unknown>[]) => list.map((e) => ({ ...base, ...e }));
      const resume = {
        ...sample,
        education: pick(sample.education[0]!, entries.education),
        work: pick(sample.work[0]!, entries.work),
        projects: pick(sample.projects[0]!, entries.projects),
        awards: pick(sample.awards[0]!, entries.awards),
      } as typeof sample;
      let rows: EntryRow[] = [];
      for (let i = 0; i < runs; i += 1) rows = (await raf.runFill(document, { resume, files: {} })).report.fields;
      return rows.map((r) => ({ outcome: r.outcome, fieldKey: r.fieldKey, label: r.label, ...(r.note ? { note: r.note } : {}) }));
    },
    { entries: ENTRIES, runs },
  );
}
