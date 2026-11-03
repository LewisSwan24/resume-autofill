import { afterEach, describe, expect, it } from 'vitest';
import { getDriver, listDrivers, registerDriver, unregisterDriver } from '../../../src/drivers/registry';
import { nativeDriver } from '../../../src/drivers/native';
import type { Driver } from '../../../src/drivers/types';
import type { Control } from '../../../src/engine/types';

const el = document.createElement('div');
const control = (over: Partial<Control>): Control => ({ id: 'c1', el, kind: 'select', lib: 'native', ...over });

const fake = (id: string, lib: Driver['lib'], kinds: Driver['kinds'], match = true): Driver => ({
  id,
  lib,
  kinds,
  match: () => match,
  fill: async () => ({ ok: true, observed: null }),
  read: () => null,
});

afterEach(() => {
  for (const d of listDrivers()) unregisterDriver(d.id);
});

describe('driver registry', () => {
  it('falls back to the native driver for native controls', () => {
    expect(getDriver(control({ kind: 'text' }))).toBe(nativeDriver);
    expect(getDriver(control({ kind: 'file' }))).toBe(nativeDriver);
  });

  it('returns null for a library control nobody claims, but still drives library radios / checkboxes natively', () => {
    expect(getDriver(control({ lib: 'antd', kind: 'select' }))).toBeNull();
    expect(getDriver(control({ lib: 'antd', kind: 'cascader' }))).toBeNull();
    expect(getDriver(control({ lib: 'element', kind: 'radio' }))).toBe(nativeDriver);
  });

  it('prefers library drivers, newest registration first, only for their own lib and kinds', () => {
    const a = fake('antd-a', 'antd', ['select']);
    const b = fake('antd-b', 'antd', ['select']);
    registerDriver(a);
    registerDriver(b);
    expect(getDriver(control({ lib: 'antd', kind: 'select' }))).toBe(b);
    expect(getDriver(control({ lib: 'antd', kind: 'date' }))).toBeNull();
    expect(getDriver(control({ lib: 'element', kind: 'select' }))).toBeNull();
    expect(getDriver(control({ lib: 'native', kind: 'select' }))).toBe(nativeDriver);
    // A library driver outranks the native driver for library radios.
    const radio = fake('antd-radio', 'antd', ['radio']);
    registerDriver(radio);
    expect(getDriver(control({ lib: 'antd', kind: 'radio' }))).toBe(radio);
  });

  it('skips drivers whose match() declines, and re-registering an id replaces it', () => {
    registerDriver(fake('x', 'antd', ['select'], false));
    expect(getDriver(control({ lib: 'antd', kind: 'select' }))).toBeNull();
    const again = fake('x', 'antd', ['select'], true);
    registerDriver(again);
    expect(listDrivers()).toHaveLength(1);
    expect(getDriver(control({ lib: 'antd', kind: 'select' }))).toBe(again);
  });
});
