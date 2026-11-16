// The copied-link card on Home: a hint before any read, each clip read once, only the stamp
// and digests of waved-away links saved, the offer itself in memory only.
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useCallback, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ClipboardCard } from '../../../../mobile/app/src/clipboard/ClipboardCard';
import { linkDigest, type ClipOffer } from '../../../../mobile/app/src/clipboard/clipboardOffer';
import { useClipboardOffer } from '../../../../mobile/app/src/clipboard/useClipboardOffer';
import { createFakeClipboard, type FakeClipboard } from '../../../../mobile/app/src/native/clipboardPeek';
import { ApplicationRecordSchema, defaultAppState, type AppState } from '../../../../mobile/app/src/store/appStateStore';
import { setLanguage } from '../../../../src/i18n';

const WAIT = { timeout: 3000 };
const LINK = 'https://jobs.example.com/campus';

interface Rig {
  clip: FakeClipboard;
  onOpen: ReturnType<typeof vi.fn>;
  state(): AppState;
  setActive(active: boolean): void;
  setOffer(on: boolean): void;
  focus(): Promise<void>;
}

function rig(init: { active?: boolean; state?: AppState; text?: string | null; stamp?: number | null } = {}): Rig {
  const clip = createFakeClipboard({ text: init.text === undefined ? `示例科技校园招聘 ${LINK}` : init.text, stamp: init.stamp === undefined ? 100 : init.stamp });
  const onOpen = vi.fn();
  let current = init.state ?? defaultAppState({ onboardingDone: true });
  let setActiveOuter: (a: boolean) => void = () => undefined;
  let setStateOuter: (f: (s: AppState) => AppState) => void = () => undefined;
  function Harness() {
    const [state, setState] = useState(current);
    const [active, setActive] = useState(init.active ?? true);
    current = state;
    setActiveOuter = setActive;
    setStateOuter = setState;
    const update = useCallback(async (change: (s: AppState) => AppState) => {
      setState((s) => {
        current = change(s);
        return current;
      });
      return true;
    }, []);
    const offer = useClipboardOffer({ native: clip, appState: state, updateAppState: update, active, onOpen });
    return (
      <main>
        <h1 tabIndex={-1}>首页</h1>
        {offer.offer ? <ClipboardCard offer={offer.offer} onOpen={offer.open} onDismiss={offer.dismiss} /> : null}
      </main>
    );
  }
  render(<Harness />);
  return {
    clip,
    onOpen,
    state: () => current,
    setActive: (a) => act(() => setActiveOuter(a)),
    setOffer: (on) => act(() => setStateOuter((s) => ({ ...s, clipboard: { ...s.clipboard, offer: on } }))),
    focus: async () => {
      await act(async () => {
        clip.focus();
        for (let i = 0; i < 10; i += 1) await Promise.resolve();
      });
    },
  };
}

beforeEach(() => setLanguage('zh'));
afterEach(cleanup);

describe('the clipboard card', () => {
  it('focus with a new link shows the card with its host', async () => {
    const r = rig();
    const card = await screen.findByRole('region', { name: '打开刚复制的链接？' }, WAIT);
    expect(card.textContent).toContain('jobs.example.com');
    expect(card.textContent).toContain('示例科技校园招聘');
    expect(screen.getByRole('status').textContent).toContain('打开刚复制的链接？');
    expect(r.clip.hints).toBeGreaterThanOrEqual(1);
    expect(r.clip.reads).toBe(1);
  });

  it('打开 hands the offer over and the card goes', async () => {
    const r = rig();
    await screen.findByRole('region', { name: '打开刚复制的链接？' }, WAIT);
    fireEvent.click(screen.getByRole('button', { name: '打开' }));
    expect(r.onOpen).toHaveBeenCalledTimes(1);
    const offer = r.onOpen.mock.calls[0]![0] as ClipOffer;
    expect(offer.links.map((l) => l.url)).toEqual([LINK]);
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull(), WAIT);
  });

  it('several links offer 选一个打开', async () => {
    const r = rig({ text: 'https://a.example.com/ 和 https://b.example.com/' });
    const card = await screen.findByRole('region', { name: '刚复制的文字里有 2 个链接' }, WAIT);
    expect(card).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: '选一个打开' }));
    expect((r.onOpen.mock.calls[0]![0] as ClipOffer).links).toHaveLength(2);
  });

  it('不用了 hides the card and stores the digest, not the link', async () => {
    const r = rig();
    await screen.findByRole('region', { name: '打开刚复制的链接？' }, WAIT);
    fireEvent.click(screen.getByRole('button', { name: '不打开这个链接' }));
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull(), WAIT);
    await waitFor(() => expect(r.state().clipboard.dismissed).toEqual([expect.stringMatching(/^[0-9a-f]{32}$/)]), WAIT);
    expect(r.state().clipboard.dismissed[0]).toBe(await linkDigest(LINK));
    expect(document.activeElement?.tagName).toBe('H1');
    // A new clip with the same link is not offered again.
    r.clip.set({ stamp: 200 });
    await r.focus();
    expect(r.clip.reads).toBe(2);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('the same clip is not read twice', async () => {
    const r = rig();
    await screen.findByRole('region', { name: '打开刚复制的链接？' }, WAIT);
    await r.focus();
    await r.focus();
    expect(r.clip.reads).toBe(1);
    expect(r.clip.hints).toBeGreaterThanOrEqual(3);
  });

  it('switch off: no hint calls', async () => {
    const r = rig({ state: defaultAppState({ onboardingDone: true, clipboard: { offer: false, lastStamp: null, dismissed: [] } }) });
    await r.focus();
    expect(r.clip.hints).toBe(0);
    expect(r.clip.reads).toBe(0);
  });

  it('turning the switch off clears the card', async () => {
    const r = rig();
    await screen.findByRole('region', { name: '打开刚复制的链接？' }, WAIT);
    r.setOffer(false);
    await waitFor(() => expect(screen.queryByRole('region')).toBeNull(), WAIT);
  });

  it('lastStamp is saved even when nothing is offered', async () => {
    const r = rig({ text: '没有链接的一段话', stamp: 555 });
    await waitFor(() => expect(r.state().clipboard.lastStamp).toBe(555), WAIT);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('a link already in the tracker is not offered', async () => {
    const record = ApplicationRecordSchema.parse({ id: 'r1', url: LINK, host: 'jobs.example.com', statusAt: 1, createdAt: 1, openedAt: 1, updatedAt: 1 });
    const r = rig({ state: defaultAppState({ onboardingDone: true, applications: [record] }) });
    await waitFor(() => expect(r.state().clipboard.lastStamp).toBe(100), WAIT);
    expect(screen.queryByRole('region')).toBeNull();
  });

  it('no card while inactive (onboarding, browser, import); the check runs when it becomes active', async () => {
    const r = rig({ active: false });
    await r.focus();
    expect(r.clip.hints).toBe(0);
    r.setActive(true);
    await screen.findByRole('region', { name: '打开刚复制的链接？' }, WAIT);
  });

  it('a sensitive or not-a-link clip is never read', async () => {
    const r = rig({ active: false });
    r.clip.set({ sensitive: true });
    r.setActive(true);
    await r.focus();
    r.clip.set({ sensitive: false, likelyUrl: 'no', stamp: 101 });
    await r.focus();
    expect(r.clip.reads).toBe(0);
  });

  it('app state never holds the copied text', async () => {
    const r = rig();
    await screen.findByRole('region', { name: '打开刚复制的链接？' }, WAIT);
    const saved = JSON.stringify(r.state());
    expect(saved).not.toContain('jobs.example.com');
    expect(saved).not.toContain('示例科技');
  });
});
