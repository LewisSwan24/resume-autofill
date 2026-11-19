import { describe, expect, it } from 'vitest';
import { contextOptionsFor, parseDevice } from '../../../scripts/capture/device';

describe('capture device', () => {
  it('desktop keeps the viewport every existing sample was captured at', () => {
    const options = contextOptionsFor('desktop', 'en-AU');
    expect(options.viewport).toEqual({ width: 1280, height: 900 });
    expect(options.isMobile).toBeFalsy();
    expect(options.hasTouch).toBeFalsy();
    expect(options.locale).toBe('en-AU');
  });

  it('mobile looks like an Android phone, so sites serve their phone pages', () => {
    const options = contextOptionsFor('mobile', 'zh-CN');
    expect(options.isMobile).toBe(true);
    expect(options.hasTouch).toBe(true);
    expect(options.viewport!.width).toBeLessThan(500);
    // A headed login window has to fit a laptop screen, browser bars included.
    expect(options.viewport!.height).toBeLessThanOrEqual(700);
    expect(options.userAgent).toMatch(/Android/);
    expect(options.userAgent).toMatch(/Mobile/);
    expect(options.locale).toBe('zh-CN');
  });

  it('accepts only the known devices', () => {
    expect(parseDevice(undefined)).toBe('desktop');
    expect(parseDevice('mobile')).toBe('mobile');
    expect(() => parseDevice('tablet')).toThrow(/desktop or mobile/);
  });
});
