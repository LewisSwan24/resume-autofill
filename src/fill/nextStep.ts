// Multi-step forms: find the page's own "Next" button, tell it apart from the button that sends the application,
// and say when the page needs the user before it can move on. Pure DOM; the extension never presses "Submit".
import { isPlaceholderOption } from '../dictionary/options';
import { isVisible } from '../engine/visibility';

export type StepButtonKind = 'next' | 'submit' | 'other';

/** Anything that sends, or might send, the application. Checked first: a button that says both is never pressed. */
const SENDS = /提交|投递|申请|完成|确认|submit|apply|send|finish|\bdone\b|complete/i;
/** The whole label, once trimmed of arrows and punctuation. "下一页" / "Next page" are pagers, not steps. */
const NEXT =
  /^(?:下一步|继续|继续填写|保存并继续|保存并下一步|保存[，,\s]*下一步|next|next step|continue|save\s*(?:and|&)\s*(?:continue|next)|proceed)$/i;

const normalize = (text: string): string =>
  text
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '')
    .toLowerCase();

export function classifyStepButton(text: string): StepButtonKind {
  const label = normalize(text);
  if (!label) return 'other';
  if (SENDS.test(label)) return 'submit';
  return NEXT.test(label) ? 'next' : 'other';
}

export type StepAction =
  | { kind: 'next'; button: HTMLElement }
  /** A Next button that the page has switched off until something is filled in. */
  | { kind: 'disabled' }
  /** Only a button that sends: this is the last step. */
  | { kind: 'final' }
  /** Next buttons that disagree, or a Next and a send button side by side. */
  | { kind: 'ambiguous' }
  | { kind: 'none' };

const BUTTONS = 'button, input[type=submit], input[type=button], [role=button]';

function buttonText(el: HTMLElement): string {
  const text = el instanceof HTMLInputElement ? el.value : (el.textContent ?? '');
  return text.trim() || el.getAttribute('aria-label') || el.getAttribute('title') || '';
}

const isDisabled = (el: HTMLElement): boolean =>
  (el as HTMLButtonElement).disabled === true || el.getAttribute('aria-disabled') === 'true';

/**
 * What moving on from this step would take. `adapterSelector` narrows the search to the button a site adapter
 * knows; its label is still read, so a "Submit" in the Next button's place is the final step.
 */
export function findStepAction(doc: Document, adapterSelector?: string): StepAction {
  const all = (sel: string) => Array.from(doc.querySelectorAll<HTMLElement>(sel)).filter((el) => isVisible(el));
  let candidates = adapterSelector ? all(adapterSelector) : [];
  if (candidates.length === 0) candidates = all(BUTTONS);

  const next: Array<{ el: HTMLElement; label: string }> = [];
  let sends = 0;
  for (const el of candidates) {
    const text = buttonText(el);
    const kind = classifyStepButton(text);
    if (kind === 'submit') sends++;
    else if (kind === 'next') next.push({ el, label: normalize(text) });
  }
  if (next.length === 0) return sends > 0 ? { kind: 'final' } : { kind: 'none' };
  if (sends > 0) return { kind: 'ambiguous' };
  if (new Set(next.map((n) => n.label)).size > 1) return { kind: 'ambiguous' };
  const chosen = next[next.length - 1]!.el;
  return isDisabled(chosen) ? { kind: 'disabled' } : { kind: 'next', button: chosen };
}

export type PageBlocker = 'needs_you' | 'verification';

const CONTROLS =
  'input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]), select, textarea';
const VERIFICATION_TEXT = /验证码|校验码|verification code|captcha|security code|one[-\s]?time (?:code|password)|\botp\b/i;
const VERIFICATION_WIDGETS =
  'iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="captcha"], iframe[src*="turnstile"], [class*="geetest"], [class*="captcha" i], [id*="captcha" i]';

function describedAs(el: HTMLElement): string {
  const labels = 'labels' in el ? Array.from((el as HTMLInputElement).labels ?? []).map((l) => l.textContent ?? '') : [];
  return [el.getAttribute('placeholder'), el.getAttribute('aria-label'), el.getAttribute('name'), ...labels].filter(Boolean).join(' ');
}

const isRequired = (el: HTMLElement): boolean =>
  (el as HTMLInputElement).required === true || el.getAttribute('aria-required') === 'true';

/** Nothing chosen: no option selected, or the one selected is a prompt ("Select…", Angular's blank "? undefined ?"). */
function selectUnanswered(el: HTMLSelectElement): boolean {
  const opt = el.selectedIndex >= 0 ? el.options[el.selectedIndex] : undefined;
  return !opt || isPlaceholderOption({ label: (opt.label || opt.textContent || '').trim(), value: opt.value });
}

/** Where pages put the message a check has failed. */
const ERROR_BOXES = '[role="alert"], [class*="error" i]';
/** The message saying an answer is missing. */
const REQUIRED_ERROR = /\b(?:is|are)\s+required\b|\brequired\s+(?:field|question)\b|^required[.!]?$|必填|不能为空|不得为空|不可为空/i;
/** Past this, the box holds more than one short message: it is a section, not an error. */
const MAX_ERROR_CHARS = 80;

/** The text of a box that the page is actually showing: a hidden message inside a visible wrapper does not count. */
function shownText(box: HTMLElement): string {
  const walker = box.ownerDocument.createTreeWalker(box, NodeFilter.SHOW_TEXT);
  let text = '';
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.parentElement && isVisible(node.parentElement)) text += node.textContent ?? '';
  }
  return text.replace(/\s+/g, ' ').trim();
}

/** The page is showing "a response is required" next to a question it checked itself. */
function showsRequiredError(doc: Document): boolean {
  return Array.from(doc.querySelectorAll<HTMLElement>(ERROR_BOXES)).some((box) => {
    if (!isVisible(box)) return false;
    const text = shownText(box);
    return text.length > 0 && text.length <= MAX_ERROR_CHARS && REQUIRED_ERROR.test(text);
  });
}

/** Why this step cannot be left to run on its own, or null when nothing on it is waiting for the user. */
export function pageBlocker(doc: Document): PageBlocker | null {
  if (Array.from(doc.querySelectorAll<HTMLElement>(VERIFICATION_WIDGETS)).some((el) => isVisible(el))) return 'verification';

  const controls = Array.from(doc.querySelectorAll<HTMLElement>(CONTROLS)).filter((el) => isVisible(el));
  if (controls.some((el) => VERIFICATION_TEXT.test(describedAs(el)))) return 'verification';

  if (Array.from(doc.querySelectorAll<HTMLElement>('[aria-invalid="true"]')).some((el) => isVisible(el))) return 'needs_you';
  if (showsRequiredError(doc)) return 'needs_you';

  for (const el of controls) {
    if (!isRequired(el) || (el as HTMLInputElement).disabled) continue;
    if (el instanceof HTMLInputElement && el.type === 'radio') {
      const scope = el.form ?? doc;
      const group = el.name
        ? Array.from(scope.querySelectorAll<HTMLInputElement>('input[type=radio]')).filter((r) => r.name === el.name)
        : [el];
      if (!group.some((r) => r.checked)) return 'needs_you';
    } else if (el instanceof HTMLInputElement && el.type === 'checkbox') {
      if (!el.checked) return 'needs_you';
    } else if (el instanceof HTMLInputElement && el.type === 'file') {
      if ((el.files?.length ?? 0) === 0) return 'needs_you';
    } else if (el instanceof HTMLSelectElement) {
      if (selectUnanswered(el)) return 'needs_you';
    } else if (!(el as HTMLInputElement).value?.trim()) {
      return 'needs_you';
    }
  }
  return null;
}

function hash(text: string): string {
  let h = 5381;
  for (let i = 0; i < text.length; i++) h = ((h << 5) + h + text.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/**
 * Which step the page is on: the adapter's step name when it has one, otherwise the set of fields showing (a
 * single-page form swaps them out between steps). Values are left out, so typing never changes it.
 */
export function stepFingerprint(doc: Document, adapterStep: string | null): string {
  if (adapterStep) return `step:${adapterStep}`;
  const ids = Array.from(doc.querySelectorAll<HTMLElement>(CONTROLS))
    .filter((el) => isVisible(el))
    .map((el) => `${el.tagName}:${el.getAttribute('name') || el.id || el.getAttribute('aria-label') || el.getAttribute('placeholder') || ''}`);
  return `fields:${ids.length}:${hash(ids.join('|'))}`;
}
