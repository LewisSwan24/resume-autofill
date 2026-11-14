// The review screen of the resume import: one column of module sections with field rows, a summary, the target
// card and a sticky bottom bar. Rendered from a hand-made ReadSuccess through the review model; no libraries.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useMemo, useReducer } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { planMerge } from '../../../../mobile/app/src/resumeImport/merge';
import { MergePreviewSheet } from '../../../../mobile/app/src/resumeImport/MergePreviewSheet';
import { ReviewScreen } from '../../../../mobile/app/src/resumeImport/ReviewScreen';
import { initReview, reviewReduce } from '../../../../mobile/app/src/resumeImport/review';
import type { ImportFile, ReadSuccess } from '../../../../mobile/app/src/resumeImport/types';
import { BackStackContext, createBackStack } from '../../../../mobile/app/src/ui';
import { setLanguage } from '../../../../src/i18n';
import type { DraftField } from '../../../../src/import/parse';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../../src/schema';

const TEXTS = [
  '张三',
  '电话：13800138000',
  '邮箱：zhangsan@example.com',
  '教育经历',
  '示例大学 2016.09 - 2020.06',
  '计算机科学与技术 本科',
  '工作经历',
  '示例科技有限公司 2020.07 - 至今',
  '前端工程师',
  '负责网页开发',
];
const field = (path: string, value: string, line: number, certainty: DraftField['certainty'] = 'high'): DraftField => ({ path, value, line, certainty });
const FIELDS: DraftField[] = [
  field('basics.familyName', '张', 0),
  field('basics.givenName', '三', 0),
  field('contact.phone', '13800138000', 1),
  field('contact.email', 'zhangsan@example.com', 2, 'check'),
  field('education.0.school', '示例大学', 4),
  field('education.0.startDate', '2016-09', 4),
  field('education.0.endDate', '2020-06', 4),
  field('education.0.major', '计算机科学与技术', 5, 'check'),
  field('work.0.company', '示例科技有限公司', 7),
  field('work.0.startDate', '2020-07', 7),
  field('work.0.current', 'true', 7),
  field('work.0.position', '前端工程师', 8, 'check'),
  field('work.0.description', '负责网页开发', 9),
];

function readOf(fields: DraftField[] = FIELDS): ReadSuccess {
  return {
    ok: true,
    kind: 'pdf',
    lines: TEXTS.map((text) => ({ text, cells: [text], page: 1, fontSize: 10 })),
    draft: { locale: 'zh-CN', fields },
    pages: 1,
    language: { locale: 'zh-CN', mixed: false },
  };
}

const FILE: ImportFile = { name: '张三简历.pdf', mimeType: 'application/pdf', bytes: new Uint8Array([37, 80, 68, 70]), source: 'picker' };

function profileOf(resumes: { id: string; title: string; basics?: Record<string, string>; contact?: Record<string, string> }[]): Profile {
  return ProfileSchema.parse({
    schemaVersion: 1,
    resumes: resumes.map((r) => ResumeSchema.parse({ locale: 'zh-CN', createdAt: 1, updatedAt: 1, ...r })),
    activeResumeId: resumes[0]?.id ?? null,
    settings: { uiLanguage: 'zh' },
  });
}

const defaultTitle = (locale: string) => (locale === 'zh-CN' ? '我的中文简历' : 'My English resume');

function Harness({ read, profile, onSubmit }: { read: ReadSuccess; profile: Profile | null; onSubmit: () => void }) {
  const backStack = useMemo(() => createBackStack(), []);
  const [state, dispatch] = useReducer(reviewReduce, null, () => initReview(read, FILE, profile, defaultTitle));
  return (
    <BackStackContext.Provider value={backStack}>
      <ReviewScreen state={state} dispatch={dispatch} profile={profile} busy={false} headingId="ri-h" onCancel={vi.fn()} onSubmit={onSubmit} />
    </BackStackContext.Provider>
  );
}

function renderReview(over: { read?: ReadSuccess; profile?: Profile | null } = {}) {
  const onSubmit = vi.fn();
  render(<Harness read={over.read ?? readOf()} profile={over.profile === undefined ? profileOf([]) : over.profile} onSubmit={onSubmit} />);
  return { onSubmit };
}

const primary = () => screen.getByRole('button', { name: /^(导入|合并) \d+ 项$/ });

beforeEach(() => setLanguage('zh'));
afterEach(cleanup);

describe('review screen', () => {
  it('shows each module as a heading and each field as a labelled box with its value', () => {
    renderReview();
    expect(screen.getByRole('heading', { level: 1, name: '核对导入的内容' })).toBeTruthy();
    expect(screen.getByText('来自「张三简历.pdf」')).toBeTruthy();
    for (const name of ['基本信息', '联系方式', '教育经历', '工作 / 实习经历']) {
      expect(screen.getByRole('heading', { level: 2, name })).toBeTruthy();
    }
    expect(screen.getByRole('heading', { level: 3, name: '教育经历 1' })).toBeTruthy();
    expect((screen.getByLabelText('姓') as HTMLInputElement).value).toBe('张');
    expect((screen.getByLabelText('名') as HTMLInputElement).value).toBe('三');
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).value).toBe('zhangsan@example.com');
    expect((screen.getByLabelText('邮箱') as HTMLInputElement).type).toBe('email');
    expect((screen.getByLabelText('学校') as HTMLInputElement).value).toBe('示例大学');
    expect(screen.getByLabelText('描述').tagName).toBe('TEXTAREA');
    // current is hidden: no row for it
    expect(screen.queryByLabelText(/至今/)).toBeNull();
  });

  it('a field to check shows 需核对 and its hint, described by aria-describedby', () => {
    renderReview();
    const box = screen.getByLabelText('邮箱');
    const ids = (box.getAttribute('aria-describedby') ?? '').split(/\s+/).filter(Boolean);
    const described = ids.map((id) => document.getElementById(id)?.textContent ?? '').join(' ');
    expect(described).toContain('这一项是推测出来的，请确认。');
    const row = box.closest('.m-ri-row') as HTMLElement;
    expect(within(row).getByText('需核对')).toBeTruthy();
    const sure = screen.getByLabelText('姓').closest('.m-ri-row') as HTMLElement;
    expect(within(sure).queryByText('需核对')).toBeNull();
  });

  it('turning off 导入：邮箱 shows 不导入 and lowers the number on 导入 n 项', () => {
    renderReview();
    expect(primary().textContent?.trim()).toBe('导入 12 项');
    const keep = screen.getByRole('switch', { name: '导入：邮箱' }) as HTMLInputElement;
    expect(keep.checked).toBe(true);
    fireEvent.click(keep);
    expect(keep.checked).toBe(false);
    const row = keep.closest('.m-ri-row') as HTMLElement;
    expect(row.classList.contains('m-ri-row--skipped')).toBe(true);
    expect(within(row).getByText('不导入')).toBeTruthy();
    expect(primary().textContent?.trim()).toBe('导入 11 项');
  });

  it('看原文 shows five lines with the source one current; the button says 收起原文 and is expanded', () => {
    renderReview();
    const button = screen.getByRole('button', { name: '看原文：学校' });
    expect(button.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    expect(button.textContent).toContain('收起原文');
    const list = document.getElementById(button.getAttribute('aria-controls')!)!;
    const lines = within(list).getAllByRole('listitem');
    expect(lines).toHaveLength(5);
    const current = lines.filter((li) => li.getAttribute('aria-current') === 'true');
    expect(current).toHaveLength(1);
    expect(current[0]!.textContent).toContain('原文第 5 行');
    expect(current[0]!.textContent).toContain('示例大学 2016.09 - 2020.06');
    expect(lines[0]!.textContent).toContain('邮箱：zhangsan@example.com'); // only line-2 … line+2
    fireEvent.click(button);
    expect(document.getElementById(button.getAttribute('aria-controls')!)).toBeNull();
  });

  it('不导入这条 collapses the entry to 已移除 with 恢复 focused; 恢复 brings it back and focuses its heading', () => {
    renderReview();
    fireEvent.click(screen.getByRole('button', { name: '不导入：示例大学' }));
    expect(screen.getByText('已移除：示例大学')).toBeTruthy();
    expect(screen.queryByLabelText('学校')).toBeNull();
    const restore = screen.getByRole('button', { name: '恢复：示例大学' });
    expect(document.activeElement).toBe(restore);
    expect(primary().textContent?.trim()).toBe('导入 8 项');
    fireEvent.click(restore);
    expect((screen.getByLabelText('学校') as HTMLInputElement).value).toBe('示例大学');
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 3, name: '教育经历 1' }));
  });

  it('merge target shows 现有 values, 和现有内容一样 for equal ones, and 覆盖 only for different ones', () => {
    renderReview({ profile: profileOf([{ id: 'r1', title: '我的简历', basics: { familyName: '张' }, contact: { email: 'old@example.com' } }]) });
    const merge = screen.getByRole('radio', { name: /合并到「我的简历」/ });
    expect(merge.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(merge);
    expect(merge.getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('只填现在空着的项，已有的内容不变。')).toBeTruthy();
    const family = screen.getByLabelText('姓').closest('.m-ri-row') as HTMLElement;
    expect(within(family).getByText('现有：张')).toBeTruthy();
    expect(within(family).getByText('和现有内容一样')).toBeTruthy();
    expect(screen.queryByRole('checkbox', { name: '覆盖：姓' })).toBeNull();
    const email = screen.getByLabelText('邮箱').closest('.m-ri-row') as HTMLElement;
    expect(within(email).getByText('现有：old@example.com')).toBeTruthy();
    const overwrite = screen.getByRole('checkbox', { name: '覆盖：邮箱' }) as HTMLInputElement;
    expect(overwrite.checked).toBe(false);
    expect(screen.queryByRole('checkbox', { name: '覆盖：手机号码' })).toBeNull();
    expect(primary().textContent?.trim()).toMatch(/^合并 \d+ 项$/);
  });

  it('the summary reads 认出 n 项，其中 m 项需要你看一眼', () => {
    renderReview();
    expect(screen.getByText('认出 12 项，其中 3 项需要你看一眼。')).toBeTruthy();
  });

  it('只看需要核对的 hides sure fields', () => {
    renderReview();
    const only = screen.getByRole('switch', { name: '只看需要核对的' });
    fireEvent.click(only);
    expect(screen.queryByLabelText('姓')).toBeNull();
    expect(screen.queryByRole('heading', { level: 2, name: '基本信息' })).toBeNull();
    expect(screen.getByLabelText('邮箱')).toBeTruthy();
    expect(screen.getByText('认出 12 项，其中 3 项需要你看一眼。')).toBeTruthy();
    fireEvent.click(only);
    expect(screen.getByLabelText('姓')).toBeTruthy();
  });

  it('refused values show the error, and the action moves focus to the first one', async () => {
    const fields = FIELDS.map((f) => (f.path === 'education.0.startDate' ? { ...f, value: '2016年秋' } : f));
    const { onSubmit } = renderReview({ read: readOf(fields) });
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('格式不对，改一下或者不导入这一项。');
    expect(screen.getByText('有 1 项格式不对，改好后才能导入。')).toBeTruthy();
    fireEvent.click(primary());
    expect(onSubmit).not.toHaveBeenCalled();
    expect(document.activeElement).toBe(screen.getAllByLabelText('开始时间')[0]);
    // Turning the field off clears the error.
    fireEvent.click(screen.getAllByRole('switch', { name: '导入：开始时间' })[0]!);
    await waitFor(() => expect(screen.queryByRole('alert')).toBeNull());
    fireEvent.click(primary());
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it('the bottom bar hides while the keyboard is open', () => {
    class FakeViewport extends EventTarget {
      width = 400;
      height = 800;
      resize(height: number) {
        this.height = height;
        this.dispatchEvent(new Event('resize'));
      }
    }
    const viewport = new FakeViewport();
    const original = Object.getOwnPropertyDescriptor(window, 'visualViewport');
    Object.defineProperty(window, 'visualViewport', { configurable: true, value: viewport });
    try {
      renderReview();
      expect(primary()).toBeTruthy();
      act(() => screen.getByLabelText('姓').focus());
      act(() => viewport.resize(450));
      expect(screen.queryByRole('button', { name: /^导入 \d+ 项$/ })).toBeNull();
      act(() => viewport.resize(800));
      expect(primary()).toBeTruthy();
    } finally {
      if (original) Object.defineProperty(window, 'visualViewport', original);
      else delete (window as { visualViewport?: unknown }).visualViewport;
    }
  });

  it('只看需要核对的 stays while it is on, even once nothing is left to check, so the rest can come back', () => {
    const fields = FIELDS.map((f) => (f.certainty === 'check' && f.path !== 'contact.email' ? { ...f, certainty: 'high' as const } : f));
    renderReview({ read: readOf(fields) });
    fireEvent.click(screen.getByRole('switch', { name: '只看需要核对的' }));
    expect(screen.queryByLabelText('姓')).toBeNull();
    fireEvent.click(screen.getByRole('switch', { name: '导入：邮箱' }));
    const only = screen.getByRole('switch', { name: '只看需要核对的' }) as HTMLInputElement;
    expect(only.checked).toBe(true);
    fireEvent.click(only);
    expect(screen.getByLabelText('姓')).toBeTruthy();
    // Off, with nothing to check, it goes.
    expect(screen.queryByRole('switch', { name: '只看需要核对的' })).toBeNull();
  });

  it('merge rows and the merge preview show choices by their labels, not their stored codes', () => {
    const resume = ResumeSchema.parse({
      id: 'r1',
      title: '我的简历',
      locale: 'zh-CN',
      createdAt: 1,
      updatedAt: 1,
      education: [{ school: '示例大学', startDate: '2016-09', degree: 'bachelor' }],
    });
    const profile = ProfileSchema.parse({ schemaVersion: 1, resumes: [resume], activeResumeId: 'r1', settings: { uiLanguage: 'zh' } });
    const fields = [...FIELDS, field('education.0.degree', 'master', 5)];
    renderReview({ profile, read: readOf(fields) });
    fireEvent.click(screen.getByRole('radio', { name: /合并到/ }));
    const row = document.querySelector('[data-ri-path="education.0.degree"]') as HTMLElement;
    expect(within(row).getByText('现有：本科')).toBeTruthy();
    expect(row.textContent).not.toContain('bachelor');

    const state = [{ type: 'target', target: { kind: 'merge', resumeId: 'r1' } }, { type: 'overwrite', path: 'education.0.degree', on: true }].reduce(
      (s, a) => reviewReduce(s, a as Parameters<typeof reviewReduce>[1]),
      initReview(readOf(fields), FILE, profile, defaultTitle),
    );
    cleanup();
    render(
      <BackStackContext.Provider value={createBackStack()}>
        <MergePreviewSheet open plan={planMerge(state, resume)} state={state} busy={false} onConfirm={vi.fn()} onClose={vi.fn()} />
      </BackStackContext.Provider>,
    );
    expect(screen.getByText('学历：本科 → 硕士')).toBeTruthy();
  });

  it('the mixed-language notice offers a change below only when there is one (a new resume)', () => {
    const read = { ...readOf(), language: { locale: 'zh-CN' as const, mixed: true } };
    // The active resume is blank, so the default target is a merge into it: no language control there.
    renderReview({ read, profile: profileOf([{ id: 'r1', title: '我的简历' }]) });
    expect(screen.getByRole('radio', { name: /合并到「我的简历」/ }).getAttribute('aria-checked')).toBe('true');
    expect(screen.getByText('这份简历中英文都有，按中文读取。')).toBeTruthy();
    expect(screen.queryByText(/可以在下面改/)).toBeNull();
    fireEvent.click(screen.getByRole('radio', { name: '新建一份简历' }));
    expect(screen.getByText('这份简历中英文都有，按中文处理，可以在下面改。')).toBeTruthy();
  });

  it('the English summary reads right with one item to check', () => {
    act(() => setLanguage('en'));
    const fields = FIELDS.map((f) => (f.certainty === 'check' && f.path !== 'contact.email' ? { ...f, certainty: 'high' as const } : f));
    renderReview({ read: readOf(fields) });
    expect(screen.getByText('Found 12 items; 1 to check.')).toBeTruthy();
  });

  it('the keep switch and 看原文 are named with the words they show', () => {
    renderReview();
    const keep = screen.getByRole('switch', { name: '导入：邮箱' });
    fireEvent.click(keep);
    expect(screen.getByRole('switch', { name: '不导入：邮箱' })).toBe(keep);
    const source = screen.getByRole('button', { name: '看原文：学校' });
    fireEvent.click(source);
    expect(screen.getByRole('button', { name: '收起原文：学校' })).toBe(source);
    act(() => setLanguage('en'));
    expect(screen.getByRole('switch', { name: 'Not imported: Email' })).toBe(keep);
    expect(screen.getByRole('button', { name: 'Hide original: School' })).toBe(source);
  });

  it('every button, switch, checkbox, input and select has an accessible name in zh and in en', () => {
    const profile = profileOf([{ id: 'r1', title: '我的简历', basics: { familyName: '李' } }]);
    const fields = [...FIELDS, field('education.0.degree', 'bachelor', 5)];
    renderReview({ profile, read: readOf(fields) });
    fireEvent.click(screen.getByRole('radio', { name: /合并到/ }));
    fireEvent.click(screen.getByRole('button', { name: '看原文：学校' }));
    for (const language of ['zh', 'en'] as const) {
      act(() => setLanguage(language));
      for (const role of ['button', 'switch', 'checkbox', 'textbox', 'combobox', 'radio'] as const) {
        const all = screen.queryAllByRole(role);
        const named = screen.queryAllByRole(role, { name: /\S/ });
        expect([language, role, named.length]).toEqual([language, role, all.length]);
      }
      expect(screen.getAllByRole('switch').length).toBeGreaterThan(3);
      expect(screen.getAllByRole('checkbox').length).toBeGreaterThan(0);
      expect(screen.getAllByRole('combobox').length).toBeGreaterThan(0);
    }
    expect(screen.getByRole('heading', { level: 1, name: 'Check what was read' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Import: Email' })).toBeTruthy();
  });
});
