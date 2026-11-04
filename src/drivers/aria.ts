// ARIA comboboxes: react-select and hand-written widgets (role=combobox, or a button with
// aria-haspopup=listbox). The list usually exists only while open and often lives in a portal, so it is
// found again on every look, and only a list that is really on screen is ever read.
import { isPlaceholderOption } from '../dictionary/options';
import type { Control, OptionInfo } from '../engine/types';
import { isVisible } from '../engine/visibility';
import { isRetired, visibleOptions, type DropdownOption } from './dropdown';
import { fireBlur, fireInput, focusElement, pressKey, setNativeValue, simulateClick } from './events';
import { ANSWER_BUTTON_SELECTOR, ariaValueScope } from './libraries';
import type { Driver, DriverContext, FillIntent, FillResult, OptionMatch, OptionMatcher } from './types';
import { waitFor } from './wait';

const LISTBOX = '[role=listbox]';
const OPTION = '[role=option]';
const SINGLE_VALUE = '[class*="single-value"], [class*="singleValue"]';
const MULTI_VALUE = '[class*="multi-value__label"], [class*="multiValue"] > :first-child';

const OPEN_ON_FOCUS_MS = 80;
const OPEN_MS = 300;
const LOAD_MS = 1500;
const SETTLE_MS = 800;
const AFTER_LEAVING_MS = 60;

const squash = (s: string | null | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();
const failed = (detail: string, observed: string | null = null): FillResult => ({
  ok: false,
  observed,
  outcome: 'action_failed',
  detail,
});

function inputOf(el: HTMLElement): HTMLInputElement | null {
  if (el instanceof HTMLInputElement) return el;
  return el.querySelector<HTMLInputElement>('input:not([type=hidden])');
}

function searchRoots(el: Element): (Document | ShadowRoot)[] {
  const root = el.getRootNode();
  return root === el.ownerDocument ? [el.ownerDocument] : [root as ShadowRoot, el.ownerDocument];
}

/** An empty list some widgets keep in the page has no height: it is not open. */
const isOnScreen = (el: Element): boolean => {
  if (isRetired(el) || !isVisible(el)) return false;
  return el.getClientRects().length === 0 || el.getBoundingClientRect().height > 0;
};

/** Clicking a button with no type inside a form would submit it, and this extension never submits. */
export function clickWithoutSubmit(el: Element): void {
  const win = el.ownerDocument.defaultView;
  const stop = (event: Event): void => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  win?.addEventListener('submit', stop, true);
  try {
    simulateClick(el);
  } finally {
    win?.removeEventListener('submit', stop, true);
  }
}

function listsOnScreen(el: Element): HTMLElement[] {
  return searchRoots(el).flatMap((r) => Array.from(r.querySelectorAll<HTMLElement>(LISTBOX)).filter(isOnScreen));
}

const declaredListIds = (el: Element): string[] =>
  ['aria-controls', 'aria-owns'].flatMap((a) => (el.getAttribute(a) ?? '').split(/\s+/).filter(Boolean));

/** The list this combobox itself points at, when it says so and that list is on screen. */
function referencedList(el: HTMLElement): HTMLElement | null {
  const byId = (id: string): HTMLElement | null => {
    for (const r of searchRoots(el)) {
      const hit = r.querySelector<HTMLElement>(`[id="${CSS.escape(id)}"]`);
      if (hit) return hit;
    }
    return null;
  };
  for (const id of declaredListIds(el)) {
    const target = byId(id);
    if (target && isOnScreen(target)) return target.matches(LISTBOX) ? target : (target.querySelector<HTMLElement>(LISTBOX) ?? target);
  }
  const active = el.getAttribute('aria-activedescendant');
  const list = active ? byId(active)?.closest<HTMLElement>(LISTBOX) : null;
  return list && isOnScreen(list) ? list : null;
}

function nearest(el: Element, lists: HTMLElement[]): HTMLElement | null {
  const t = el.getBoundingClientRect();
  const distance = (l: HTMLElement): number => {
    const r = l.getBoundingClientRect();
    return Math.abs(r.left - t.left) + Math.abs(r.top - t.bottom);
  };
  return lists.reduce<HTMLElement | null>((best, l) => (!best || distance(l) < distance(best) ? l : best), null);
}

// ------------------------------------------------------------------ reading

function readItems(el: HTMLElement): string[] {
  const scope = ariaValueScope(el);
  const texts = (selector: string): string[] =>
    Array.from(scope.querySelectorAll(selector))
      .map((n) => squash(n.textContent))
      .filter(Boolean);
  const multi = texts(MULTI_VALUE);
  if (multi.length > 0) return multi;
  const single = texts(SINGLE_VALUE);
  if (single.length > 0) return single;
  const input = inputOf(el);
  if (input) return input.value.trim() ? [input.value.trim()] : [];
  // A button shows the value as its text, or a prompt when nothing is chosen.
  const shown = squash(el.textContent);
  const prompt = /^(?:please\s+)?(?:select|choose|pick)\b/i.test(shown) || isPlaceholderOption({ label: shown });
  return shown && !prompt ? [shown] : [];
}

const readText = (el: HTMLElement): string | null => readItems(el).join(', ') || null;

/** Widgets may show less than the option says: "+61" for "Australia +61". */
export function sameChoice(shown: string, label: string): boolean {
  if (!shown) return false;
  // As whole words: "Male" is not part of "Female".
  const within = (part: string, whole: string): boolean =>
    new RegExp(`(?:^|[^\\p{L}\\p{N}])${part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:$|[^\\p{L}\\p{N}])`, 'iu').test(whole);
  return within(shown, label) || within(label, shown);
}

const infos = (labels: string[]): OptionInfo[] => labels.map((label) => ({ label }));

// ------------------------------------------------------------------ one fill

class Session {
  readonly input: HTMLInputElement | null;
  /** Lists already on screen before we touched anything belong to something else. */
  private readonly before: Set<HTMLElement>;
  private readonly initialText: string;
  /** What the control showed before we touched it. */
  readonly shownBefore: string[];
  /** What we typed last: an input still holding it has not necessarily taken a choice. */
  typed: string | null = null;

  constructor(
    readonly el: HTMLElement,
    readonly ctx: DriverContext,
  ) {
    this.input = inputOf(el);
    this.initialText = this.input?.value ?? '';
    this.shownBefore = readItems(el);
    this.before = new Set(listsOnScreen(el).filter((l) => l !== referencedList(el)));
  }

  list(): HTMLElement | null {
    const own = referencedList(this.el);
    // A combobox that names its list means that one; a list that turns up elsewhere is another control's.
    if (own || declaredListIds(this.el).length > 0) return own;
    return nearest(this.el, listsOnScreen(this.el).filter((l) => !this.before.has(l)));
  }

  options(): DropdownOption[] {
    const list = this.list();
    return list ? visibleOptions(list, OPTION) : [];
  }

  wait<T>(check: () => T | null, timeout: number): Promise<T | null> {
    return waitFor(check, { timeout: Math.min(this.ctx.timeoutMs, timeout), root: this.el.ownerDocument, signal: this.ctx.signal });
  }

  async open(): Promise<HTMLElement | null> {
    const now = this.list();
    if (now) return now;
    focusElement(this.input ?? this.el);
    const onFocus = await this.wait(() => this.list(), OPEN_ON_FOCUS_MS);
    if (onFocus) return onFocus;
    if (this.ctx.attempt === 1) clickWithoutSubmit(this.input ?? this.el);
    else pressKey(this.input ?? this.el, 'ArrowDown');
    return this.wait(() => this.list(), OPEN_MS);
  }

  canType(): boolean {
    return !!this.input && !this.input.readOnly;
  }

  type(text: string): void {
    const input = this.input!;
    setNativeValue(input, text);
    fireInput(input, text);
    this.typed = text;
  }

  clearTyped(): void {
    if (this.typed === null || !this.input) return;
    setNativeValue(this.input, this.initialText);
    fireInput(this.input, null, 'deleteContentBackward');
    this.typed = null;
  }

  /** Close without clicking on the page. Escape only while a list is open: it may also close a dialog. */
  async close(): Promise<void> {
    const target = this.input ?? this.el;
    if (this.list()) {
      pressKey(target, 'Escape');
      const closed = await this.wait(() => (this.list() ? null : true), OPEN_MS);
      // A button that opened the list may close it only by being clicked again.
      if (!closed && !this.input) {
        clickWithoutSubmit(this.el);
        await this.wait(() => (this.list() ? null : true), OPEN_MS);
      }
    }
    fireBlur(target);
  }
}

type Picked = { label: string; query: string | null };
type Resolved = Picked | { fail: FillResult };

export function verdict(m: OptionMatch, opts: DropdownOption[], query: string | null): Resolved {
  if (m.status === 'matched') {
    const hit = opts[m.index];
    return hit ? { label: hit.info.label, query } : { fail: failed('matched option vanished') };
  }
  if (m.status === 'ambiguous') {
    const labels = [...new Set(m.candidates.map((i) => opts[i]?.info.label).filter((l): l is string => !!l))];
    return { fail: { ok: false, observed: null, outcome: 'needs_review', candidates: labels } };
  }
  return { fail: { ok: false, observed: null, outcome: 'no_option', detail: 'no matching option' } };
}

/** Decide which option a matcher picks, without selecting anything. Types the query when nothing fits yet. */
async function resolve(s: Session, query: string, match: OptionMatcher): Promise<Resolved> {
  const look = (o: DropdownOption[]): OptionMatch => match(o.map((x) => x.info));
  let opts = s.options();
  let m = look(opts);
  if (m.status !== 'none' || !s.canType() || !squash(query)) return verdict(m, opts, null);
  s.type(query);
  const hit = await s.wait(() => {
    const now = s.options();
    return look(now).status !== 'none' ? now : null;
  }, LOAD_MS);
  opts = hit ?? s.options();
  m = look(opts);
  return verdict(m, opts, query);
}

async function select(s: Session, pick: Picked): Promise<boolean> {
  const find = (): HTMLElement | null => s.options().find((o) => o.info.label === pick.label)?.el ?? null;
  let option = find();
  if (!option) {
    await s.open();
    option = await s.wait(find, OPEN_MS);
  }
  if (!option && pick.query !== null && s.canType()) {
    s.type(pick.query);
    option = await s.wait(find, LOAD_MS);
  }
  if (!option) return false;
  clickWithoutSubmit(option);
  return true;
}

function isCommitted(s: Session, label: string): boolean {
  const shown = readItems(s.el);
  if (!shown.some((v) => sameChoice(v, label))) return false;
  // Nothing changed and the list is still up, and what was there only resembles the choice: the click did not take.
  const unchanged = shown.join('\n') === s.shownBefore.join('\n');
  if (unchanged && s.list() && !shown.some((v) => v.toLowerCase() === label.toLowerCase())) return false;
  // An input holding what we typed proves nothing until the list has gone away with the right text left.
  if (s.typed !== null && shown.length === 1 && shown[0] === s.typed) return s.typed === label && !s.list();
  return true;
}

function matchersOf(intent: FillIntent): { query: string; match: OptionMatcher }[] | null {
  if (intent.kind === 'choice') return [{ query: intent.query, match: intent.match }];
  if (intent.kind === 'multi') return intent.items;
  return null;
}

async function selectAll(s: Session, missing: { query: string; match: OptionMatcher }[], picks: Picked[]): Promise<FillResult> {
  const { el, ctx } = s;
  const opened = await s.open();
  if (!opened && !s.canType()) return failed('list did not open');

  // Resolve every value first, so a miss or an ambiguity changes nothing.
  for (const w of missing) {
    if (ctx.signal?.aborted) return failed('aborted');
    const r = await resolve(s, w.query, w.match);
    if ('fail' in r) return r.fail;
    if (!picks.some((p) => p.label === r.label)) picks.push(r);
    if (missing.length > 1) s.clearTyped();
  }

  for (const pick of picks) {
    if (ctx.signal?.aborted) return failed('aborted');
    if (!(await select(s, pick))) return failed(`option "${pick.label}" not clickable`);
    const ok = await s.wait(() => (isCommitted(s, pick.label) ? true : null), SETTLE_MS);
    if (!ok) return failed(`selection of "${pick.label}" did not stick`);
  }
  return { ok: true, observed: readText(el) };
}

async function fill(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const el = control.el;
  const wanted = matchersOf(intent);
  if (!wanted || wanted.length === 0) return failed(`unsupported intent for a combobox: ${intent.kind}`);
  if (!control.multiple && wanted.length > 1) return failed('several values for a single-select');

  // What is already showing needs no click, and a multi-select hides what it already holds.
  const current = infos(readItems(el));
  const missing = wanted.filter((w) => w.match(current).status !== 'matched');
  if (missing.length === 0) return { ok: true, observed: readText(el) };

  const s = new Session(el, ctx);
  const picks: Picked[] = [];
  let result: FillResult | undefined;
  try {
    result = await selectAll(s, missing, picks);
  } finally {
    if (!result?.ok) s.clearTyped();
    await s.close();
  }
  if (!result.ok) return { ...result, observed: readText(el) };

  // Some widgets take a value back when the field is left.
  await new Promise((resolve) => setTimeout(resolve, AFTER_LEAVING_MS));
  const shown = readItems(el);
  const kept = picks.every((p) => shown.some((v) => sameChoice(v, p.label)));
  return kept ? { ok: true, observed: readText(el) } : failed('the value did not survive leaving the field', readText(el));
}

// ------------------------------------------------------------------ answer buttons

const answerButtons = (group: Element): DropdownOption[] => visibleOptions(group, `:scope > ${ANSWER_BUTTON_SELECTOR}`);

const pressedAnswer = (group: Element): string | null => {
  const pressed = group.querySelector(`:scope > ${ANSWER_BUTTON_SELECTOR}[aria-pressed="true"]`);
  return pressed ? squash(pressed.textContent) || null : null;
};

async function pressAnswer(control: Control, intent: FillIntent, ctx: DriverContext): Promise<FillResult> {
  const group = control.el;
  if (intent.kind !== 'choice') return failed(`unsupported intent for answer buttons: ${intent.kind}`);
  const buttons = answerButtons(group);
  const r = verdict(intent.match(buttons.map((b) => b.info)), buttons, null);
  if ('fail' in r) return { ...r.fail, observed: pressedAnswer(group) };
  // Pressing the pressed answer again could take it back.
  if (pressedAnswer(group) === r.label) return { ok: true, observed: r.label };
  clickWithoutSubmit(buttons.find((b) => b.info.label === r.label)!.el);
  const ok = await waitFor(() => (pressedAnswer(group) === r.label ? true : null), {
    timeout: Math.min(ctx.timeoutMs, SETTLE_MS),
    root: group.ownerDocument,
    signal: ctx.signal,
  });
  return ok ? { ok: true, observed: r.label } : failed(`answer "${r.label}" did not stick`, pressedAnswer(group));
}

export const ariaAnswerButtonsDriver: Driver = {
  id: 'aria-answer-buttons',
  lib: 'aria',
  kinds: ['radio'],
  match: () => true,
  fill: async (control, intent, ctx) => {
    try {
      return await pressAnswer(control, intent, ctx);
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error), pressedAnswer(control.el));
    }
  },
  read: (control) => pressedAnswer(control.el),
};

export const ariaDriver: Driver = {
  id: 'aria-combobox',
  lib: 'aria',
  kinds: ['select'],
  match: () => true,
  fill: async (control, intent, ctx) => {
    try {
      return await fill(control, intent, ctx);
    } catch (error) {
      return failed(error instanceof Error ? error.message : String(error), readText(control.el));
    }
  },
  read: (control) => readText(control.el),
};
