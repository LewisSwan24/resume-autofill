// 「用系统浏览器打开」 in page info: another browser, never this app, gets the page; the demo has no such
// action; with no other browser the toast says so.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { useMemo, useSyncExternalStore } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { BrowserScreen } from '../../../../mobile/app/src/browser/BrowserScreen';
import { DEMO_URL } from '../../../../mobile/app/src/browser/model/constants';
import { createBrowserSession } from '../../../../mobile/app/src/browser/model/session';
import { createFakeFillBrowser } from '../../../../mobile/app/src/browser/native';
import { mt } from '../../../../mobile/app/src/i18n';
import { createFakeBrowserRole, type FakeBrowserRole } from '../../../../mobile/app/src/native/browserRole';
import { BackStackContext, createBackStack } from '../../../../mobile/app/src/ui';
import { setLanguage } from '../../../../src/i18n';
import { ProfileSchema } from '../../../../src/schema';

const WAIT = { timeout: 3000 };
const profile = ProfileSchema.parse({ schemaVersion: 1, resumes: [], activeResumeId: null, settings: { uiLanguage: 'zh' } });

async function renderBrowser(url: string, demo: boolean, role: FakeBrowserRole) {
  const native = createFakeFillBrowser();
  native.deliver = () => true;
  const session = createBrowserSession({
    target: { url, demo },
    native,
    getFillContext: () => ({ profile, fillLanguage: 'active' }),
    readFile: async () => null,
    onTitle: () => undefined,
    translate: (key, params) => mt('zh', key, params),
  });
  function Harness() {
    const state = useSyncExternalStore(session.subscribe, session.getState);
    const backStack = useMemo(() => createBackStack(), []);
    const files = useMemo(() => ({ info: async () => null }), []);
    return (
      <BackStackContext.Provider value={backStack}>
        <BrowserScreen
          open={{ session, state, native }}
          profile={profile}
          files={files}
          browserRole={role}
          onClose={() => undefined}
          onGoToResume={() => undefined}
          showToast={() => undefined}
        />
      </BackStackContext.Provider>
    );
  }
  render(<Harness />);
  await waitFor(() => expect(native.callsOf('open')).toHaveLength(1), WAIT);
  const nav = { url, generation: 1, canGoBack: false, canGoForward: false };
  act(() => {
    native.emit('navigation', { phase: 'started', ...nav });
    native.emit('navigation', { phase: 'finished', ...nav });
  });
  return native;
}

async function openInfo(hostName: string) {
  fireEvent.click(screen.getByRole('button', { name: hostName }));
  return screen.findByRole('dialog', { name: '网页信息' }, WAIT);
}

beforeEach(() => setLanguage('zh'));
afterEach(cleanup);

describe('page info: 用系统浏览器打开', () => {
  it('web pages offer 用系统浏览器打开 and call openInOtherBrowser with the url', async () => {
    const role = createFakeBrowserRole({ others: 1 });
    const native = await renderBrowser('https://jobs.example.com/apply', false, role);
    const info = await openInfo('网页信息：jobs.example.com');
    fireEvent.click(within(info).getByRole('button', { name: '用系统浏览器打开' }));
    await waitFor(() => expect(role.calls.filter((c) => c.method === 'openInOtherBrowser')).toHaveLength(1), WAIT);
    expect(role.calls.find((c) => c.method === 'openInOtherBrowser')!.args).toEqual({ url: 'https://jobs.example.com/apply', title: '用系统浏览器打开' });
    // The app's own VIEW would come back here when it is the default browser: the old action is not offered.
    expect(within(info).queryByRole('button', { name: '用手机浏览器打开' })).toBeNull();
    expect(native.callsOf('openExternal')).toHaveLength(0);
    // The sheet closes; the page stays.
    await waitFor(() => expect(screen.queryByRole('dialog', { name: '网页信息' })).toBeNull(), WAIT);
  });

  it('not on the demo', async () => {
    const role = createFakeBrowserRole({ others: 1 });
    await renderBrowser(DEMO_URL, true, role);
    const info = await openInfo('网页信息：示例表单（App 自带）');
    expect(within(info).queryByRole('button', { name: '用系统浏览器打开' })).toBeNull();
  });

  it('no other browser shows the toast', async () => {
    const role = createFakeBrowserRole({ others: 0 });
    await renderBrowser('https://jobs.example.com/apply', false, role);
    const info = await openInfo('网页信息：jobs.example.com');
    fireEvent.click(within(info).getByRole('button', { name: '用系统浏览器打开' }));
    expect(await screen.findByText('没有找到别的浏览器。', undefined, WAIT)).toBeTruthy();
  });
});
