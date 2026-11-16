// 「在微信里填？用简历输入法」: under Home's paste box for WeChat-only links, and on the
// fill browser's open-another-app sheet for WeChat. Never without the plugin (no onKeyboardSetup).
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { PasteLinkCard } from '../../../../mobile/app/src/home/PasteLinkCard';
import { ExternalLinkSheet, type AskDecision } from '../../../../mobile/app/src/browser/ExternalLinkSheet';
import { BackStackContext, createBackStack } from '../../../../mobile/app/src/ui';
import { setLanguage } from '../../../../src/i18n';

const WAIT = { timeout: 3000 };
const TITLE = '在微信里填？用简历输入法';

function paste(onKeyboardSetup?: () => void) {
  const onOpen = vi.fn(async (_link: { ok: true; host: string }) => undefined);
  render(<PasteLinkCard onOpen={onOpen} showToast={() => undefined} onKeyboardSetup={onKeyboardSetup} />);
  const box = screen.getByRole('textbox', { name: '网申链接' });
  return { onOpen, type: (text: string) => fireEvent.change(box, { target: { value: text } }) };
}

function sheet(decision: AskDecision, onKeyboardSetup?: () => void) {
  render(
    <BackStackContext.Provider value={createBackStack()}>
      <ExternalLinkSheet decision={decision} onOpen={() => undefined} onCopy={() => undefined} onClose={() => undefined} onKeyboardSetup={onKeyboardSetup} />
    </BackStackContext.Provider>,
  );
}

beforeEach(() => setLanguage('zh'));
afterEach(cleanup);

describe('Home paste box hint', () => {
  it('a mini program text shows the hint with its line, and the button leads to the setup screen', () => {
    const onKeyboardSetup = vi.fn();
    const { type } = paste(onKeyboardSetup);
    expect(screen.queryByText(TITLE)).toBeNull();
    type('#小程序://示例招聘/abc123');
    const hint = screen.getByRole('note', { name: TITLE });
    expect(within(hint).getByText('这是微信小程序的链接，只能在微信里打开。在小程序里，可以用简历输入法一项项填。')).toBeTruthy();
    expect(hint.querySelector('[data-icon="keyboard"]')).toBeTruthy();
    fireEvent.click(within(hint).getByRole('button', { name: '设置简历输入法' }));
    expect(onKeyboardSetup).toHaveBeenCalledTimes(1);
  });

  it('a weixin:// link gets the app line', () => {
    const { type } = paste(() => undefined);
    type('weixin://scanqrcode');
    expect(within(screen.getByRole('note', { name: TITLE })).getByText('要在微信里填，可以用简历输入法。')).toBeTruthy();
  });

  it('an ordinary link shows no hint', async () => {
    const { type } = paste(() => undefined);
    type('https://jobs.example.com/campus');
    await waitFor(() => expect(screen.getByText(/将打开|jobs\.example\.com/)).toBeTruthy(), WAIT);
    expect(screen.queryByRole('note', { name: TITLE })).toBeNull();
  });

  it('a WeChat sign-in link shows the login line, and 打开 still opens it', async () => {
    const { type, onOpen } = paste(() => undefined);
    const url = 'https://open.weixin.qq.com/connect/oauth2/authorize?appid=x&redirect_uri=https%3A%2F%2Fjobs.example.com';
    type(url);
    expect(within(screen.getByRole('note', { name: TITLE })).getByText('这个页面要用微信登录，App 里登录不了。可以在微信里打开这个页面，再用简历输入法填。')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '打开' }));
    await waitFor(() => expect(onOpen).toHaveBeenCalledTimes(1), WAIT);
    expect(onOpen.mock.calls[0]![0]).toMatchObject({ ok: true, host: 'open.weixin.qq.com' });
  });

  it('the paste error stays, with the hint under it', () => {
    const { type } = paste(() => undefined);
    type('weixin://scanqrcode');
    fireEvent.click(screen.getByRole('button', { name: '打开' }));
    const error = document.querySelector('.m-help--error');
    expect(error).toBeTruthy();
    const hint = screen.getByRole('note', { name: TITLE });
    expect(error!.compareDocumentPosition(hint) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('no hint without the plugin', () => {
    const { type } = paste(undefined);
    type('#小程序://示例招聘/abc123');
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});

describe('Open-another-app sheet hint', () => {
  it('WeChat shows the hint above the copy button; it leads to the setup screen', () => {
    const onKeyboardSetup = vi.fn();
    sheet({ action: 'app', app: 'weixin', url: 'weixin://dl/business/?t=abc' }, onKeyboardSetup);
    const dialog = screen.getByRole('dialog', { name: '这个链接要打开别的 App' });
    const hint = within(dialog).getByRole('note', { name: TITLE });
    expect(within(hint).getByText('要在微信里填，可以用简历输入法。')).toBeTruthy();
    const copy = within(dialog).getByRole('button', { name: '复制链接' });
    expect(hint.compareDocumentPosition(copy) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(within(hint).getByRole('button', { name: '设置简历输入法' }));
    expect(onKeyboardSetup).toHaveBeenCalledTimes(1);
  });

  it('another app gets no hint', () => {
    sheet({ action: 'app', app: 'alipay', url: 'alipays://platformapi/startapp' }, () => undefined);
    expect(screen.getByRole('dialog', { name: '这个链接要打开别的 App' })).toBeTruthy();
    expect(screen.queryByText(TITLE)).toBeNull();
  });

  it('no hint without the plugin', () => {
    sheet({ action: 'app', app: 'weixin', url: 'weixin://scanqrcode' }, undefined);
    expect(screen.getByRole('dialog', { name: '这个链接要打开别的 App' })).toBeTruthy();
    expect(screen.queryByText(TITLE)).toBeNull();
  });
});
