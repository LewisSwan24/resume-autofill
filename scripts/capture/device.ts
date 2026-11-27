// The browser a page is captured with, and later replayed with. A phone capture has to look like a phone
// (narrow viewport, touch, a mobile user agent), or the site serves its desktop page instead.
import type { BrowserContextOptions, LaunchOptions } from '@playwright/test';
import { PHONE, type CaptureDevice } from '../../src/capture/device.ts';

export type { CaptureDevice };

export const DEFAULT_LOCALE = 'en-AU';

const PHONE_CONTEXT: BrowserContextOptions = {
  viewport: { width: PHONE.width, height: PHONE.height },
  screen: { width: PHONE.screenWidth, height: PHONE.screenHeight },
  deviceScaleFactor: PHONE.deviceScaleFactor,
  isMobile: true,
  hasTouch: true,
  userAgent: PHONE.userAgent,
};

export function parseDevice(value: string | undefined): CaptureDevice {
  if (value === undefined || value === 'desktop') return 'desktop';
  if (value === 'mobile') return 'mobile';
  throw new Error(`device must be desktop or mobile, not "${value}"`);
}

export function contextOptionsFor(device: CaptureDevice, locale: string = DEFAULT_LOCALE): BrowserContextOptions {
  return device === 'mobile' ? { ...PHONE_CONTEXT, locale } : { viewport: { width: 1280, height: 900 }, locale };
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
