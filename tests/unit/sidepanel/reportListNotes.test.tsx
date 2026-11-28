// What a report row says under its label when the fill left the box to the applicant for a reason of its own.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { ReportList } from '../../../entrypoints/sidepanel/ReportList';
import type { FieldReport } from '../../../src/engine/types';
import { setLanguage } from '../../../src/i18n';

const dateRow: FieldReport = {
  fieldId: 'cert-date', frameId: 0, label: '取得日期', fieldKey: 'certificates.date', section: 'certificates',
  outcome: 'needs_review', confidence: 1, value: '2021-09', source: 'certificates[0].date', note: 'day_missing', entry: 0,
};

let host: HTMLDivElement;
let root: Root;
const env = globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean };

beforeEach(() => {
  env.IS_REACT_ACT_ENVIRONMENT = true;
  host = document.body.appendChild(document.createElement('div'));
  root = createRoot(host);
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  setLanguage('en');
});

const render = (fields: FieldReport[]) => act(() => root.render(<ReportList fields={fields} onFocus={() => undefined} onApply={async (field) => ({ ok: true, field })} />));

describe('a box that wants a day the resume does not hold', () => {
  it('says so, with the month the resume has, in Chinese', () => {
    setLanguage('zh');
    render([dateRow]);
    expect(host.textContent).toContain('表单要填到日，简历里只有年月（2021-09）');
  });

  it('and in English', () => {
    setLanguage('en');
    render([dateRow]);
    expect(host.textContent).toContain('your resume has only the month (2021-09)');
  });

  it('a row with no note says nothing of the kind', () => {
    setLanguage('en');
    render([{ ...dateRow, note: undefined }]);
    expect(host.textContent).not.toContain('only the month');
  });
});
