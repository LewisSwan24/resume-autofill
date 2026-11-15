// Home's two short tracker sections.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ApplicationRecordSchema, defaultAppState, type ApplicationRecord } from '../../../../mobile/app/src/store/appStateStore';
import { HomeApplications } from '../../../../mobile/app/src/tracker/HomeApplications';
import { setLanguage } from '../../../../src/i18n';

const SH = 'Asia/Shanghai';
const NOW = Date.parse('2026-11-15T04:00:00Z');

const rec = (id: string, o: Partial<ApplicationRecord> = {}): ApplicationRecord =>
  ApplicationRecordSchema.parse({
    id,
    url: `https://jobs.example.com/${id}`,
    host: 'jobs.example.com',
    company: `示例${id}`,
    statusAt: 1,
    createdAt: 1,
    openedAt: 1,
    updatedAt: 1,
    ...o,
  });

beforeEach(() => setLanguage('zh'));
afterEach(cleanup);

const show = (records: ApplicationRecord[]) => {
  const handlers = { onOpenDetail: vi.fn(), onOpenPage: vi.fn(), onShowAll: vi.fn() };
  render(<HomeApplications appState={defaultAppState({ applications: records })} {...handlers} now={() => NOW} timeZone={SH} />);
  return handlers;
};

const section = (name: string) => screen.getByRole('region', { name });
const names = (el: HTMLElement) => [...el.querySelectorAll('.rt-row__name')].map((n) => n.textContent);

describe('HomeApplications', () => {
  it('快截止了 and 正在填写 with at most three rows each', () => {
    const h = show([
      rec('A', { status: 'wish', deadline: { date: '2026-11-18' }, openedAt: 9 }),
      rec('B', { status: 'filling', deadline: { date: '2026-11-16' }, openedAt: 8 }),
      rec('C', { status: 'wish', deadline: { date: '2026-11-17' }, openedAt: 7 }),
      rec('D', { status: 'wish', deadline: { date: '2026-11-19' }, openedAt: 6 }),
      rec('E', { status: 'filling', openedAt: 5 }),
      rec('F', { status: 'filling', openedAt: 4 }),
      rec('G', { status: 'filling', openedAt: 3 }),
      rec('H', { status: 'filling', openedAt: 2 }),
    ]);
    expect(names(section('快截止了'))).toEqual(['示例B', '示例C', '示例A']);
    expect(names(section('正在填写'))).toEqual(['示例E', '示例F', '示例G']);
    fireEvent.click(within(section('快截止了')).getByRole('button', { name: '打开示例B的网申页面' }));
    expect(h.onOpenPage).toHaveBeenCalledWith(expect.objectContaining({ id: 'B' }));
    fireEvent.click(within(section('正在填写')).getAllByRole('button')[0]!);
    expect(h.onOpenDetail).toHaveBeenCalledWith('E');
  });

  it('the all-applications link shows the count', () => {
    const h = show([rec('A', { status: 'submitted' }), rec('B', { status: 'closed' })]);
    expect(screen.queryByRole('region', { name: '快截止了' })).toBeNull();
    expect(screen.queryByRole('region', { name: '正在填写' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: '全部网申记录（2）' }));
    expect(h.onShowAll).toHaveBeenCalledTimes(1);
  });

  it('empty line without records', () => {
    show([]);
    expect(screen.getByText('打开过的网申页面会记在「网申」里。')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /全部网申记录/ })).toBeNull();
  });
});
