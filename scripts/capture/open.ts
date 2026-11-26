// Some application forms show only after a button on the job page (BambooHR's "Apply for This Job"), on the
// same address. `pnpm capture --open <selector>` presses that one button before the snapshot, and a replay presses
// it again before it looks for the form. It is never one that sends anything.
import type { Page } from '@playwright/test';

const SENDS = /\b(?:submit|send)\b|提交|投[遞递]|[發发]送|送出/i;

/** True when a button's words say it sends the form: such a button is never pressed. */
export function sendsForm(text: string): boolean {
  return SENDS.test(text);
}

/** Presses the button that shows the form. Throws, pressing nothing, when it reads as sending. */
export async function openForm(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.waitFor({ state: 'visible', timeout: 20_000 });
  const { text, submit } = await target.evaluate((el) => ({
    text: [el.textContent, el.getAttribute('aria-label'), el.getAttribute('value')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
    submit: el.getAttribute('type') === 'submit',
  }));
  if (submit || sendsForm(text)) throw new Error(`--open will not press "${text}": it reads as sending the form`);
  await target.click();
}
