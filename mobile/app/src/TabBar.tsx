// The bottom tab bar: 首页, 网申, 简历, 设置. It measures itself so the toast can sit above it (--m-tabbar-h) and grows
// when the labels wrap at a large font size. The shell hides it while the on-screen keyboard is open.
import { useEffect, useRef, useState } from 'react';
import { Icon, type IconName } from './Icon';
import { useMT } from './i18n';
import type { Tab } from './navigation';

const TABS: ReadonlyArray<{ tab: Tab; icon: IconName; labelKey: string }> = [
  { tab: 'home', icon: 'house', labelKey: 'm.tab.home' },
  { tab: 'applications', icon: 'list-check', labelKey: 'm.tab.apps' },
  { tab: 'resume', icon: 'person-vcard', labelKey: 'm.tab.resume' },
  { tab: 'settings', icon: 'gear', labelKey: 'm.tab.settings' },
];

export const TABBAR_HEIGHT_VAR = '--m-tabbar-h';

export function TabBar({ tab, onTab }: { tab: Tab; onTab: (tab: Tab) => void }) {
  const t = useMT();
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const root = document.documentElement;
    const measure = () => root.style.setProperty(TABBAR_HEIGHT_VAR, `${Math.round(el.getBoundingClientRect().height)}px`);
    measure();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null;
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      root.style.removeProperty(TABBAR_HEIGHT_VAR);
    };
  }, []);

  return (
    <nav ref={ref} className="m-tabbar" aria-label={t('m.nav')}>
      {TABS.map((item) => {
        const on = item.tab === tab;
        return (
          <button
            key={item.tab}
            type="button"
            className={on ? 'm-tab m-tab--on' : 'm-tab'}
            aria-current={on ? 'page' : undefined}
            onClick={() => onTab(item.tab)}
          >
            <Icon name={item.icon} />
            <span>{t(item.labelKey)}</span>
          </button>
        );
      })}
    </nav>
  );
}

/** A control that brings up the on-screen keyboard. */
function isTextEntry(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return true;
  if (el instanceof HTMLInputElement) {
    return !['checkbox', 'radio', 'file', 'button', 'submit', 'reset', 'range', 'color', 'image', 'hidden'].includes(el.type);
  }
  return el instanceof HTMLElement && el.isContentEditable;
}

/**
 * Whether the on-screen keyboard is open: a text control has focus and the visual viewport has shrunk well below
 * the tallest it has been. Hiding the tab bar then keeps it from riding above the keyboard.
 */
export function useKeyboardOpen(): boolean {
  const [open, setOpen] = useState(false);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    let tallest = viewport.height;
    let width = viewport.width;
    const check = () => {
      if (Math.abs(viewport.width - width) > 1) {
        // Turned the phone: start over.
        width = viewport.width;
        tallest = viewport.height;
      }
      tallest = Math.max(tallest, viewport.height);
      const shrunk = viewport.height < tallest * 0.8;
      // Opens only for a text control; closes only once the viewport has grown back. A tap on a button below a
      // field moves focus before the keyboard goes, and a tab bar shown at that moment would land under the finger.
      if (!shrunk) setOpen(false);
      else if (isTextEntry(document.activeElement)) setOpen(true);
    };
    viewport.addEventListener('resize', check);
    document.addEventListener('focusin', check);
    document.addEventListener('focusout', check);
    return () => {
      viewport.removeEventListener('resize', check);
      document.removeEventListener('focusin', check);
      document.removeEventListener('focusout', check);
    };
  }, []);
  return open;
}
