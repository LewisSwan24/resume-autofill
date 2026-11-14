// Jump requests from the side panel ("Add it to your profile"): one-shot, in session storage, so they reach this page
// whether it opens now or is already open. Read once, deleted at once; the page then has the target until it is done.
import { useCallback, useEffect, useState } from 'react';
import { browser } from 'wxt/browser';
import type { ProfileTarget } from '../../src/editor';
import { PROFILE_FOCUS_KEY, type ProfileFocusRequest } from '../../src/ui/pages';

const isRequest = (x: unknown): x is ProfileFocusRequest =>
  typeof x === 'object' && x !== null && typeof (x as ProfileFocusRequest).target?.module === 'string';

export function useFocusRequest(): { target: ProfileTarget | null; done: () => void } {
  const [request, setRequest] = useState<ProfileFocusRequest | null>(null);

  useEffect(() => {
    const take = (value: unknown) => {
      if (!isRequest(value)) return;
      setRequest(value);
      void browser.storage.session.remove(PROFILE_FOCUS_KEY).catch(() => undefined);
    };
    let cancelled = false;
    browser.storage.session.get(PROFILE_FOCUS_KEY).then(
      (stored) => {
        if (!cancelled) take(stored[PROFILE_FOCUS_KEY]);
      },
      () => undefined,
    );
    const onChanged = (changes: Record<string, { newValue?: unknown }>, area: string) => {
      if (area === 'session' && PROFILE_FOCUS_KEY in changes) take(changes[PROFILE_FOCUS_KEY]!.newValue);
    };
    browser.storage.onChanged.addListener(onChanged);
    return () => {
      cancelled = true;
      browser.storage.onChanged.removeListener(onChanged);
    };
  }, []);

  const done = useCallback(() => setRequest(null), []);
  return { target: request?.target ?? null, done };
}

const JUMP_MARK_MS = 2000;
// Somewhere to type first: a tag list holds remove buttons before its text box, and Enter there would delete a tag.
// A switch (yes / no) has only its button.
const TYPING = 'input, select, textarea';
const firstControl = (holder: ParentNode | null | undefined) =>
  holder?.querySelector<HTMLElement>(TYPING) ?? holder?.querySelector<HTMLElement>('button') ?? null;

/** The control to focus for a target on the page as rendered now; a list without that entry offers its Add button. */
export function findJumpControl(target: ProfileTarget, root: ParentNode = document): HTMLElement | null {
  if (target.module === 'attachments') {
    return firstControl(root.querySelector<HTMLElement>(`[data-slot="${target.field}"]`));
  }
  const base = target.module === 'about' ? '' : target.entry === undefined ? `${target.module}.` : `${target.module}.${target.entry}.`;
  const holder = root.querySelector<HTMLElement>(`[data-field-path="${base}${target.field}"]`);
  return (
    firstControl(holder) ??
    (target.entry === undefined ? null : root.querySelector<HTMLElement>(`[data-add-module="${target.module}"]`))
  );
}

/** Focus the control, bring it into view, and mark it for two seconds (the CSS fades the mark unless motion is reduced). */
export function focusAndMark(control: HTMLElement): void {
  control.focus({ preventScroll: true });
  const reduce = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
  control.scrollIntoView?.({ block: 'center', behavior: reduce ? 'auto' : 'smooth' });
  // A file input is transparent over its drop box, and a tag list's text box sits inside the list: mark the box.
  const mark = control.closest<HTMLElement>('.raf-upload, .raf-tags') ?? control;
  mark.classList.add('raf-jump-target');
  setTimeout(() => mark.classList.remove('raf-jump-target'), JUMP_MARK_MS);
}
