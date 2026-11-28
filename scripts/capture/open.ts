// Some application forms show only after a button on the job page (BambooHR's "Apply for This Job"), on the
// same address. `pnpm capture --open <selector>` presses that one button before the snapshot, and a replay presses
// it again before it looks for the form. It is never one that sends anything.
import type { Page } from '@playwright/test';

const SENDS = /\b(?:submit|send)\b|提交|投[遞递]|[發发]送|送出/i;

/** True when a button's words say it sends the form: such a button is never pressed. */
export function sendsForm(text: string): boolean {
  return SENDS.test(text);
}

const COOKIE_HOLDER = /cookie|consent|gdpr|onetrust|cookiebot/i;
const DECLINE = /^(?:decline|reject)\b.*\b(?:all|non-essential|optional|cookies)\b|\b(?:only necessary|necessary only|necessary cookies only|essential only|only essential)\b|^(?:拒绝|拒絕|仅必要|僅必要|只接受必要)/i;

/**
 * True for the button of a cookie banner that keeps the fewest cookies: inside something named for cookies or
 * consent (`holder`, its tags, ids and classes), and worded as declining. Accepting is never pressed.
 */
export function declinesCookies(text: string, holder: string): boolean {
  return COOKIE_HOLDER.test(holder) && DECLINE.test(text.replace(/\s+/g, ' ').trim());
}

/** A cookie banner can cover the page until answered: decline it, when one is showing. */
async function declineCookieBanner(page: Page): Promise<void> {
  const buttons = page.locator('button, [role=button], a');
  for (const button of await buttons.all()) {
    const fits = await button
      .evaluate((el) => {
        const holder: string[] = [];
        for (let n: Element | null = el; n; n = n.parentElement) holder.push(n.tagName, n.id, typeof n.className === 'string' ? n.className : '');
        const box = el.getBoundingClientRect();
        return { text: el.textContent ?? '', holder: holder.join(' '), shown: box.width > 0 && box.height > 0 };
      })
      .catch(() => null);
    if (fits?.shown && declinesCookies(fits.text, fits.holder)) {
      await button.click();
      return;
    }
  }
}

/** Presses the button that shows the form. Throws, pressing nothing, when it reads as sending. */
export async function openForm(page: Page, selector: string): Promise<void> {
  const target = page.locator(selector).first();
  await target.waitFor({ state: 'visible', timeout: 20_000 });
  await declineCookieBanner(page);
  const { text, submit } = await target.evaluate((el) => ({
    text: [el.textContent, el.getAttribute('aria-label'), el.getAttribute('value')].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim(),
    submit: el.getAttribute('type') === 'submit',
  }));
  if (submit || sendsForm(text)) throw new Error(`--open will not press "${text}": it reads as sending the form`);
  await target.click();
}
