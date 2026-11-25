// A search box need not wait out its whole budget for options: once the page's own request has come back (and the
// page has had a moment to draw it), what is on the list is all there will be. Telemetry and other sites' requests
// say nothing about the search; a page whose requests cannot be seen keeps the full wait.
import { afterEach, describe, expect, it, vi } from 'vitest';
import { watchAnswers } from '../../../src/drivers/wait';

type Entry = { name: string; initiatorType: string; responseEnd: number };

let deliver: (entries: Entry[]) => void = () => undefined;
let now = 1000;

function stubObserver(): void {
  class FakeObserver {
    constructor(cb: (list: { getEntries: () => Entry[] }) => void) {
      deliver = (entries) => cb({ getEntries: () => entries });
    }
    observe() {}
    disconnect() {}
  }
  vi.stubGlobal('PerformanceObserver', FakeObserver);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  now = 1000;
});

const own = (path: string, responseEnd: number, initiatorType = 'xmlhttprequest'): Entry => ({ name: `${location.origin}${path}`, initiatorType, responseEnd });

describe('watchAnswers', () => {
  it('says answered once the page’s own request came back and the moment to draw it has passed', () => {
    stubObserver();
    const watch = watchAnswers(document);
    expect(watch.answered(300)).toBe(false);
    deliver([own('/api/v1/info_session/suggestion/', 1050)]);
    now = 1200;
    expect(watch.answered(300)).toBe(false);
    now = 1350;
    expect(watch.answered(300)).toBe(true);
    watch.stop();
  });

  it('pays no heed to telemetry, other sites, images or scripts', () => {
    stubObserver();
    const watch = watchAnswers(document);
    deliver([
      own('/tor_browser/collect/batch/', 1010),
      { name: 'https://mcs.analytics.example/v1/list', initiatorType: 'xmlhttprequest', responseEnd: 1010 },
      own('/logo.png', 1010, 'img'),
      own('/chunk.js', 1010, 'script'),
    ]);
    now = 5000;
    expect(watch.answered(300)).toBe(false);
    deliver([own('/api/search', 1020, 'fetch')]);
    expect(watch.answered(300)).toBe(true);
  });

  it('never says answered where requests cannot be watched', () => {
    vi.stubGlobal('PerformanceObserver', undefined);
    const watch = watchAnswers(document);
    expect(watch.answered(0)).toBe(false);
    watch.stop();
  });
});
