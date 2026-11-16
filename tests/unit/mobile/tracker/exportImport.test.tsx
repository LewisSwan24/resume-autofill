// The tracker in Settings' export and import.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useMemo, useRef, useState } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { ExportSheet } from '../../../../mobile/app/src/settings/ExportSheet';
import { useImportFlow } from '../../../../mobile/app/src/settings/useImportFlow';
import { ApplicationRecordSchema, defaultAppState, type AppState, type ApplicationRecord } from '../../../../mobile/app/src/store/appStateStore';
import { createMemoryFileStore } from '../../../../mobile/app/src/store/fileStore';
import { createMemoryStore } from '../../../../mobile/app/src/store/profileStore';
import { TRACKER_KEY, withTracker } from '../../../../mobile/app/src/tracker/model/trackerTransfer';
import { BackStackContext, Toast, createBackStack, type ToastMessage } from '../../../../mobile/app/src/ui';
import { useProfileEditor } from '../../../../mobile/app/src/useProfileEditor';
import { exportProfile } from '../../../../src/editor';
import { setLanguage } from '../../../../src/i18n';
import { ProfileSchema, ResumeSchema, type Profile } from '../../../../src/schema';

const FIXED = 1_700_000_000_000;
const profileOf = (titles: string[]): Profile =>
  ProfileSchema.parse({
    schemaVersion: 1,
    resumes: titles.map((title, i) => ResumeSchema.parse({ id: `r${i}`, title, locale: 'zh-CN', createdAt: FIXED, updatedAt: FIXED })),
    activeResumeId: titles.length > 0 ? 'r0' : null,
    settings: { uiLanguage: 'zh' },
  });

const rec = (id: string, o: Partial<ApplicationRecord> = {}): ApplicationRecord =>
  ApplicationRecordSchema.parse({
    id,
    url: `https://jobs.example.com/${id}`,
    host: 'jobs.example.com',
    company: '示例科技',
    companyGuessed: false,
    statusAt: 1,
    createdAt: 1,
    openedAt: 1,
    updatedAt: 1,
    ...o,
  });

beforeEach(() => setLanguage('zh'));
afterEach(cleanup);

describe('export with the tracker', () => {
  async function exportWith(appState: AppState | undefined, untick = false) {
    const saved: string[] = [];
    const p = profileOf(['我的中文简历']);
    render(
      <BackStackContext.Provider value={createBackStack()}>
        <ExportSheet
          open
          onClose={() => undefined}
          profile={p}
          readStoredProfile={async () => p}
          saveDocument={async (file) => {
            saved.push(new TextDecoder().decode(file.bytes));
            return 'saved';
          }}
          showToast={() => undefined}
          appState={appState}
        />
      </BackStackContext.Provider>,
    );
    if (untick) fireEvent.click(screen.getByRole('checkbox', { name: '同时导出网申记录（2 条）' }));
    fireEvent.click(screen.getByRole('button', { name: '导出文件' }));
    await waitFor(() => expect(saved).toHaveLength(1));
    return { text: saved[0]!, profile: p };
  }

  it('export checkbox shown with records, checked by default; unchecked writes no tracker', async () => {
    const state = defaultAppState({ applications: [rec('a', { openedAt: 2 }), rec('b')] });
    const first = await exportWith(state);
    expect(screen.queryByText('网申记录写在同一个文件里，电脑上的扩展会忽略这部分。')).not.toBeNull();
    expect(first.text).toBe(withTracker(exportProfile(first.profile), state));
    cleanup();
    const second = await exportWith(state, true);
    expect(second.text).toBe(exportProfile(second.profile));
    expect(second.text).not.toContain(TRACKER_KEY);
  });

  it('no checkbox without records or without app state', async () => {
    const empty = await exportWith(defaultAppState());
    expect(screen.queryByRole('checkbox', { name: /网申记录/ })).toBeNull();
    expect(empty.text).toBe(exportProfile(empty.profile));
    cleanup();
    const none = await exportWith(undefined);
    expect(none.text).toBe(exportProfile(none.profile));
  });
});

describe('import with the tracker', () => {
  let latest: AppState;

  function Harness({ phone, app }: { phone: Profile; app: AppState }) {
    const store = useMemo(() => createMemoryStore(phone), [phone]);
    const files = useMemo(() => createMemoryFileStore(), []);
    const editor = useProfileEditor(store, 10);
    const [toast, setToast] = useState<ToastMessage | null>(null);
    const [state, setState] = useState(app);
    const ref = useRef(app);
    latest = state;
    const flow = useImportFlow({
      profile: editor.profile,
      edit: editor.edit,
      files,
      showToast: (t) => setToast({ ...t, id: Math.random() }),
      getAppState: () => ref.current,
      updateAppState: async (change) => {
        ref.current = change(ref.current);
        setState(ref.current);
        return true;
      },
    });
    return (
      <BackStackContext.Provider value={useMemo(() => createBackStack(), [])}>
        <button type="button" onClick={flow.start}>
          开始导入
        </button>
        <p data-testid="titles">{editor.profile ? editor.profile.resumes.map((r) => r.title).join('|') : 'loading'}</p>
        {flow.element}
        <Toast toast={toast} onDone={() => setToast(null)} />
      </BackStackContext.Provider>
    );
  }

  async function open(phone: Profile, app: AppState, fileText: string) {
    render(<Harness phone={phone} app={app} />);
    await waitFor(() => expect(screen.getByTestId('titles').textContent).not.toBe('loading'));
    fireEvent.click(screen.getByRole('button', { name: '开始导入' }));
    fireEvent.change(screen.getByLabelText('从文件导入'), { target: { files: [new File([fileText], 'p.json', { type: 'application/json' })] } });
    return screen.findByRole('dialog', { name: '文件里有什么' });
  }

  const fileState = defaultAppState({ applications: [rec('x1', { url: 'https://jobs.example.com/new', openedAt: 9, updatedAt: 9 }), rec('x2', { url: 'https://jobs.example.com/mine', company: '新名字', updatedAt: 50 })] });

  it('import preview shows the tracker line and checkbox', async () => {
    const sheet = await open(profileOf(['旧简历']), defaultAppState(), withTracker(exportProfile(profileOf(['新简历'])), fileState));
    expect(within(sheet).getByText('文件里还有 2 条网申记录')).toBeTruthy();
    const box = within(sheet).getByRole('checkbox', { name: '一起导入网申记录' }) as HTMLInputElement;
    expect(box.checked).toBe(true);
  });

  it('merge applies records through updateAppState', async () => {
    const mine = defaultAppState({ applications: [rec('m1', { url: 'https://jobs.example.com/mine', company: '旧名字', updatedAt: 5, openedAt: 5 })] });
    const sheet = await open(profileOf(['旧简历']), mine, withTracker(exportProfile(profileOf(['新简历'])), fileState));
    fireEvent.click(within(sheet).getByRole('button', { name: '合并：加到现有简历里' }));
    await waitFor(() => expect(latest.applications.map((r) => r.id).sort()).toEqual(['m1', 'x1']));
    expect(latest.applications.find((r) => r.id === 'm1')!.company).toBe('新名字');
    expect(screen.getByRole('status').textContent).toContain('已导入 2 条网申记录');
    fireEvent.click(screen.getByRole('button', { name: '撤销' }));
    await waitFor(() => expect(latest.applications.map((r) => r.id)).toEqual(['m1']));
    expect(latest.applications[0]!.company).toBe('旧名字');
  });

  it('replace replaces the records; an unticked box leaves them alone', async () => {
    const mine = defaultAppState({ applications: [rec('m1', { url: 'https://jobs.example.com/other', notes: '我的' })] });
    const sheet = await open(profileOf(['旧简历']), mine, withTracker(exportProfile(profileOf(['新简历'])), fileState));
    fireEvent.click(within(sheet).getByRole('button', { name: '替换：用文件里的简历换掉现有的' }));
    await waitFor(() => expect(latest.applications.map((r) => r.id)).toEqual(['x1', 'x2']));
    cleanup();
    const again = await open(profileOf(['旧简历']), mine, withTracker(exportProfile(profileOf(['新简历'])), fileState));
    fireEvent.click(within(again).getByRole('checkbox', { name: '一起导入网申记录' }));
    fireEvent.click(within(again).getByRole('button', { name: '替换：用文件里的简历换掉现有的' }));
    await waitFor(() => expect(screen.getByTestId('titles').textContent).toBe('新简历'));
    expect(latest.applications.map((r) => r.id)).toEqual(['m1']);
    expect(screen.getByRole('status').textContent).not.toContain('网申记录');
  });

  it('a phone with records but no resume merges the records, never replaces them', async () => {
    const mine = defaultAppState({ applications: [rec('m1', { url: 'https://jobs.example.com/other', notes: '我的' }), rec('m2', { url: 'https://jobs.example.com/mine', updatedAt: 5 })] });
    const sheet = await open(profileOf([]), mine, withTracker(exportProfile(profileOf(['新简历'])), fileState));
    expect(within(sheet).queryByText(/会换掉这台手机上的/)).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: '导入' }));
    await waitFor(() => expect(screen.getByTestId('titles').textContent).toBe('新简历'));
    await waitFor(() => expect(latest.applications.map((r) => r.id).sort()).toEqual(['m1', 'm2', 'x1']));
    expect(latest.applications.find((r) => r.id === 'm1')!.notes).toBe('我的');
  });

  it('replace warns that the records on this phone go too, and not when the box is unticked', async () => {
    const mine = defaultAppState({ applications: [rec('m1', { url: 'https://jobs.example.com/other' })] });
    const sheet = await open(profileOf(['旧简历']), mine, withTracker(exportProfile(profileOf(['新简历'])), fileState));
    expect(within(sheet).getByText('这台手机上的 1 条网申记录也会被换掉。')).toBeTruthy();
    fireEvent.click(within(sheet).getByRole('checkbox', { name: '一起导入网申记录' }));
    expect(within(sheet).queryByText('这台手机上的 1 条网申记录也会被换掉。')).toBeNull();
  });

  it('an invalid tracker imports the profile and says so', async () => {
    const bad = { ...JSON.parse(exportProfile(profileOf(['新简历']))), [TRACKER_KEY]: { format: 'resume-autofill-mobile-tracker', version: 1, applications: [{ id: 'x' }] } };
    const sheet = await open(profileOf(['旧简历']), defaultAppState(), JSON.stringify(bad));
    expect(within(sheet).queryByRole('checkbox', { name: '一起导入网申记录' })).toBeNull();
    fireEvent.click(within(sheet).getByRole('button', { name: '替换：用文件里的简历换掉现有的' }));
    await waitFor(() => expect(screen.getByTestId('titles').textContent).toBe('新简历'));
    expect(screen.getByRole('status').textContent).toContain('文件里的网申记录读不出来，只导入了简历。');
    expect(latest.applications).toEqual([]);
  });
});
