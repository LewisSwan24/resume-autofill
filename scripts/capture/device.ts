// The browser a page is captured with, and later replayed with. A phone capture has to look like a phone
// (narrow viewport, touch, a mobile user agent), or the site serves its desktop page instead.
import type { BrowserContextOptions, LaunchOptions } from '@playwright/test';

export type CaptureDevice = 'desktop' | 'mobile';

export const DEFAULT_LOCALE = 'en-AU';

// A Pixel 7 in Chrome. Written out rather than taken from Playwright's device list, so a Playwright
// upgrade cannot change what an existing sample is replayed with. The viewport is shorter than the
// phone's, so a logged-in capture window fits on a laptop screen with its bottom sheets in view.
const PHONE: BrowserContextOptions = {
  viewport: { width: 412, height: 680 },
  screen: { width: 412, height: 915 },
  deviceScaleFactor: 2.625,
  isMobile: true,
  hasTouch: true,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
};

export function parseDevice(value: string | undefined): CaptureDevice {
  if (value === undefined || value === 'desktop') return 'desktop';
  if (value === 'mobile') return 'mobile';
  throw new Error(`device must be desktop or mobile, not "${value}"`);
}

export function contextOptionsFor(device: CaptureDevice, locale: string = DEFAULT_LOCALE): BrowserContextOptions {
  return device === 'mobile' ? { ...PHONE, locale } : { viewport: { width: 1280, height: 900 }, locale };
}

/**
 * The live check's browser, with the extension loaded: the capture desktop, in the sample's language. Left to
 * the machine it speaks its owner's language, and a place search then answers in that language.
 */
export function liveContextOptions(locale: string, extensionDir: string): LaunchOptions & BrowserContextOptions {
  return {
    channel: 'chromium',
    headless: true,
    ...contextOptionsFor('desktop', locale),
    args: [`--disable-extensions-except=${extensionDir}`, `--load-extension=${extensionDir}`],
  };
}
