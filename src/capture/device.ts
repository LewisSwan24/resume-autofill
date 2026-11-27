// The phone a mobile sample is captured as: the recorder page makes the applicant's own tab look like it, and a replay
// opens the sample as the same one (scripts/capture/device.ts). Written out rather than taken from Playwright's device
// list, so a Playwright upgrade cannot change what an existing sample is replayed with.

export type CaptureDevice = 'desktop' | 'mobile';

// A Pixel 7 in Chrome. The viewport is shorter than the phone's, so a logged-in capture window fits on a laptop screen
// with its bottom sheets in view.
export const PHONE = {
  width: 412,
  height: 680,
  screenWidth: 412,
  screenHeight: 915,
  deviceScaleFactor: 2.625,
  userAgent:
    'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36',
  platform: 'Android',
  platformVersion: '14',
  model: 'Pixel 7',
  chromeMajor: '131',
} as const;
