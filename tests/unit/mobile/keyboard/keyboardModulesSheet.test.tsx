// 「输入法里显示的内容」: one checkbox per group in strip order; unticked groups go into
// appState.keyboard.hidden; a failed save toasts and reverts.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useMemo, useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { KeyboardModulesSheet } from '../../../../mobile/app/src/keyboard/KeyboardModulesSheet';
import { defaultAppState, type AppState } from '../../../../mobile/app/src/store/appStateStore';
import { BackStackContext, createBackStack } from '../../../../mobile/app/src/ui';
import { setLanguage } from '../../../../src/i18n';

const WAIT = { timeout: 3000 };
let latest: AppState;
let failing = false;
let toasts: string[] = [];
let closed = 0;

function Harness({ initial }: { initial: AppState }) {
  const [state, setState] = useState(initial);
  const ref = useRef(initial);
  const backStack = useMemo(() => createBackStack(), []);
  latest = state;
  return (
    <BackStackContext.Provider value={backStack}>
      <KeyboardModulesSheet
        open
        onClose={() => (closed += 1)}
        appState={state}
        updateAppState={async (change) => {
          const before = ref.current;
          ref.current = change(before);
          setState(ref.current);
          await Promise.resolve();
          if (failing) {
            ref.current = before;
            setState(before);
            return false;
          }
          return true;
        }}
        showToast={(m) => toasts.push(m.text)}
      />
    </BackStackContext.Provider>
  );
}

const ORDER = ['基本信息', '教育', '实习', '工作', '项目', '校园经历', '获奖', '技能和证书', '求职意向', '链接', '自我介绍', '其他'];
const box = (name: string) => within(screen.getByRole('dialog', { name: '输入法里显示的内容' })).getByRole('checkbox', { name }) as HTMLInputElement;

beforeEach(() => {
  setLanguage('zh');
  failing = false;
  toasts = [];
  closed = 0;
});
afterEach(cleanup);

describe('KeyboardModulesSheet', () => {
  it('is a dialog named by its title that lists every group in strip order', () => {
    render(<Harness initial={defaultAppState({ onboardingDone: true, keyboard: { show: true, hidden: ['links'] } })} />);
    const dialog = screen.getByRole('dialog', { name: '输入法里显示的内容' });
    expect(within(dialog).getByText('关掉的类别不会放进输入法用的那份简历。')).toBeTruthy();
    const boxes = within(dialog).getAllByRole('checkbox') as HTMLInputElement[];
    expect(boxes.map((b) => b.closest('label')?.textContent)).toEqual(ORDER);
    expect(boxes.map((b) => b.checked)).toEqual(ORDER.map((name) => name !== '链接'));
  });

  it('unticking hides a group, ticking shows it again', async () => {
    render(<Harness initial={defaultAppState({ onboardingDone: true })} />);
    fireEvent.click(box('教育'));
    await waitFor(() => expect(latest.keyboard.hidden).toEqual(['education']), WAIT);
    fireEvent.click(box('基本信息'));
    await waitFor(() => expect(latest.keyboard.hidden).toEqual(['basics', 'education']), WAIT);
    expect(box('教育').checked).toBe(false);
    fireEvent.click(box('教育'));
    await waitFor(() => expect(latest.keyboard.hidden).toEqual(['basics']), WAIT);
    expect(toasts).toEqual([]);
  });

  it('a failed save toasts and reverts', async () => {
    render(<Harness initial={defaultAppState({ onboardingDone: true })} />);
    failing = true;
    fireEvent.click(box('工作'));
    await waitFor(() => expect(toasts).toEqual(['没能保存，请再试一次。']), WAIT);
    expect(box('工作').checked).toBe(true);
    expect(latest.keyboard.hidden).toEqual([]);
  });

  it('closes from its close button', () => {
    render(<Harness initial={defaultAppState({ onboardingDone: true })} />);
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '关闭' }));
    expect(closed).toBe(1);
  });
});
