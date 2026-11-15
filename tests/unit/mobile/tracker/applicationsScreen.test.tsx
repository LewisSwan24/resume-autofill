// The 网申 tab's list.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useRef, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ApplicationRecordSchema, defaultAppState, type AppState, type ApplicationRecord } from '../../../../mobile/app/src/store/appStateStore';
import { ApplicationsScreen } from '../../../../mobile/app/src/tracker/ApplicationsScreen';
import type { TrackerNav } from '../../../../mobile/app/src/tracker/model/filters';
import { BackStackContext, createBackStack, type ToastMessage } from '../../../../mobile/app/src/ui';
import { setLanguage } from '../../../../src/i18n';

const SH = 'Asia/Shanghai';
const NOW = Date.parse('2026-11-15T04:00:00Z');

const rec = (id: string, o: Partial<ApplicationRecord> = {}): ApplicationRecord =>
  ApplicationRecordSchema.parse({
    id,
    url: `https://jobs.example.com/${id}`,
    host: 'jobs.example.com',
    statusAt: 1,
    createdAt: 1,
    openedAt: 1,
    updatedAt: 1,
    ...o,
  });

const RECORDS = [
  rec('a', { company: '示例科技', position: '产品经理', status: 'filling', deadline: { date: '2026-11-16' }, openedAt: 30, history: [{ at: NOW - 3 * 3_600_000, filled: 1, attention: 0, skipped: 0, undone: false }] }),
  rec('b', { company: '示例银行', status: 'wish', openedAt: 20, deadline: { date: '2026-11-20' }, notes: '笔试' }),
  rec('c', { company: '', host: 'careers.example.org', url: 'https://careers.example.org/c', status: 'submitted', openedAt: 10 }),
];

let latest: AppState;
let navNow: TrackerNav;
let failing = false;
const onOpenDetail = vi.fn<(id: string) => void>();
const onOpenPage = vi.fn<(r: ApplicationRecord) => void>();
const onPasteLink = vi.fn<() => void>();
const toasts: Omit<ToastMessage, 'id'>[] = [];

function Harness({ initial }: { initial: AppState }) {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const [nav, setNav] = useState<TrackerNav>({ filter: 'all', query: '', sort: 'opened' });
  latest = state;
  navNow = nav;
  return (
    <BackStackContext.Provider value={createBackStack()}>
      <ApplicationsScreen
        appState={state}
        updateAppState={async (change) => {
          if (failing) return false;
          ref.current = change(ref.current);
          setState(ref.current);
          return true;
        }}
        nav={nav}
        onNav={(patch) => setNav((n) => ({ ...n, ...patch }))}
        onOpenDetail={onOpenDetail}
        onOpenPage={onOpenPage}
        onPasteLink={onPasteLink}
        showToast={(t) => toasts.push(t)}
        now={() => NOW}
        timeZone={SH}
      />
    </BackStackContext.Provider>
  );
}

const rows = () => within(screen.getByRole('list', { name: '网申记录' })).getAllByRole('listitem');
const rowNames = () => rows().map((li) => li.querySelector('.rt-row__name')!.textContent);

beforeEach(() => {
  setLanguage('zh');
  onOpenDetail.mockReset();
  onOpenPage.mockReset();
  onPasteLink.mockReset();
  toasts.length = 0;
  failing = false;
});
afterEach(cleanup);

describe('ApplicationsScreen', () => {
  it('empty state offers 去粘贴链接', () => {
    render(<Harness initial={defaultAppState()} />);
    expect(screen.getByRole('heading', { level: 1, name: '网申记录' })).toBeTruthy();
    expect(screen.getByText('还没有网申记录')).toBeTruthy();
    expect(screen.queryByRole('searchbox')).toBeNull();
    expect(screen.queryByRole('radiogroup')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '去粘贴链接' }));
    expect(onPasteLink).toHaveBeenCalledTimes(1);
  });

  it('rows show company, position, host, status and deadline badge', () => {
    render(<Harness initial={defaultAppState({ applications: RECORDS })} />);
    expect(rowNames()).toEqual(['示例科技', '示例银行', 'careers.example.org']);
    const first = rows()[0]!;
    expect(within(first).getByText('填写中')).toBeTruthy();
    expect(within(first).getByText('产品经理 · jobs.example.com')).toBeTruthy();
    expect(within(first).getByText('明天截止')).toBeTruthy();
    expect(within(first).getByText('上次填写：3 小时前')).toBeTruthy();
    expect(within(rows()[1]!).getByText('还剩 5 天')).toBeTruthy();
    expect(within(rows()[1]!).getByText('还没填写过')).toBeTruthy();
    expect(within(rows()[2]!).getByText('已提交')).toBeTruthy();
    expect(screen.getByText('共 3 条')).toBeTruthy();
  });

  it('status chips are radios with counts and filter the list', () => {
    render(<Harness initial={defaultAppState({ applications: RECORDS })} />);
    const group = screen.getByRole('radiogroup', { name: '按状态筛选' });
    const all = within(group).getByRole('radio', { name: '全部，3 条' });
    expect(all.getAttribute('aria-checked')).toBe('true');
    expect(all.textContent).toBe('全部 3');
    expect(within(group).getAllByRole('radio')).toHaveLength(6);
    fireEvent.click(within(group).getByRole('radio', { name: '想投，1 条' }));
    expect(navNow.filter).toBe('wish');
    expect(within(group).getByRole('radio', { name: '想投，1 条' }).getAttribute('aria-checked')).toBe('true');
    expect(rowNames()).toEqual(['示例银行']);
    expect(screen.getByText('共 1 条')).toBeTruthy();
  });

  it('search narrows and clears', async () => {
    vi.useFakeTimers();
    try {
      render(<Harness initial={defaultAppState({ applications: RECORDS })} />);
      const box = screen.getByRole('searchbox', { name: '搜索公司、岗位或备注' });
      fireEvent.change(box, { target: { value: '笔试' } });
      expect(navNow.query).toBe('');
      act(() => vi.advanceTimersByTime(300));
      expect(navNow.query).toBe('笔试');
      expect(rowNames()).toEqual(['示例银行']);
      fireEvent.click(screen.getByRole('button', { name: '清除搜索' }));
      expect(navNow.query).toBe('');
      expect((box as HTMLInputElement).value).toBe('');
      expect(rowNames()).toHaveLength(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('no match offers 清除筛选', async () => {
    render(<Harness initial={defaultAppState({ applications: RECORDS })} />);
    fireEvent.click(screen.getByRole('radio', { name: '面试，0 条' }));
    expect(screen.getByText('没有符合条件的记录')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '清除筛选' }));
    expect(navNow).toMatchObject({ filter: 'all', query: '' });
    expect(rowNames()).toHaveLength(3);
  });

  it('sort switch', () => {
    render(<Harness initial={defaultAppState({ applications: RECORDS })} />);
    const deadline = screen.getByRole('radio', { name: '截止日期' });
    fireEvent.click(deadline);
    expect(navNow.sort).toBe('deadline');
    expect(deadline.getAttribute('aria-checked')).toBe('true');
    expect(rowNames()).toEqual(['示例科技', '示例银行', 'careers.example.org']);
    fireEvent.click(screen.getByRole('radio', { name: '最近打开' }));
    expect(navNow.sort).toBe('opened');
  });

  it('a row opens the detail; its window button opens the page', () => {
    render(<Harness initial={defaultAppState({ applications: RECORDS })} />);
    fireEvent.click(within(rows()[1]!).getAllByRole('button')[0]!);
    expect(onOpenDetail).toHaveBeenCalledWith('b');
    fireEvent.click(screen.getByRole('button', { name: '打开示例科技的网申页面' }));
    expect(onOpenPage).toHaveBeenCalledWith(RECORDS[0]);
    fireEvent.click(screen.getByRole('button', { name: '打开careers.example.org的网申页面' }));
    expect(onOpenPage).toHaveBeenLastCalledWith(RECORDS[2]);
  });

  it('add: a bad link shows the paste error; a new link creates a record and opens it; a listed link opens that record with a toast', async () => {
    render(<Harness initial={defaultAppState({ applications: RECORDS })} />);
    fireEvent.click(screen.getByRole('button', { name: '添加网申' }));
    let sheet = await screen.findByRole('dialog', { name: '添加网申' });
    fireEvent.change(within(sheet).getByLabelText('网申链接'), { target: { value: 'javascript:alert(1)' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '添加' }));
    expect(within(sheet).getByText('只能打开 http 或 https 开头的网页链接。')).toBeTruthy();
    expect(latest.applications).toHaveLength(3);

    fireEvent.change(within(sheet).getByLabelText('网申链接'), { target: { value: 'https://jobs.example.com/new' } });
    fireEvent.change(within(sheet).getByLabelText('公司'), { target: { value: ' 示例传媒 ' } });
    fireEvent.change(within(sheet).getByLabelText('岗位'), { target: { value: '设计师' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '添加' }));
    await waitFor(() => expect(latest.applications).toHaveLength(4));
    const added = latest.applications[0]!;
    expect(added).toMatchObject({ url: 'https://jobs.example.com/new', company: '示例传媒', companyGuessed: false, position: '设计师', status: 'wish' });
    expect(onOpenDetail).toHaveBeenCalledWith(added.id);
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: '添加网申' }));
    sheet = await screen.findByRole('dialog', { name: '添加网申' });
    fireEvent.change(within(sheet).getByLabelText('网申链接'), { target: { value: 'https://jobs.example.com/b#x' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '添加' }));
    await waitFor(() => expect(onOpenDetail).toHaveBeenLastCalledWith('b'));
    expect(toasts.at(-1)?.text).toBe('这个链接已经在记录里了，已为你打开那一条。');
    expect(latest.applications).toHaveLength(4);
  });
});

describe('ApplicationsScreen – edge cases', () => {
  it('add: a failed save keeps the sheet open and says so', async () => {
    render(<Harness initial={defaultAppState({ applications: RECORDS })} />);
    fireEvent.click(screen.getByRole('button', { name: '添加网申' }));
    const sheet = await screen.findByRole('dialog', { name: '添加网申' });
    failing = true;
    fireEvent.change(within(sheet).getByLabelText('网申链接'), { target: { value: 'https://jobs.example.com/new' } });
    fireEvent.click(within(sheet).getByRole('button', { name: '添加' }));
    await waitFor(() => expect(toasts.at(-1)?.text).toBe('没能保存，请再试一次。'));
    expect(screen.getByRole('dialog', { name: '添加网申' })).toBeTruthy();
    expect(onOpenDetail).not.toHaveBeenCalled();
  });
});
