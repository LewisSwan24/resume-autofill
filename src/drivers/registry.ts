// Driver registry. Library drivers (antd / Element Plus, registered by their own modules) are
// consulted first, newest registration first; the native driver is the fallback.
import type { Control } from '../engine/types';
import { nativeDriver } from './native';
import type { Driver } from './types';

const registered: Driver[] = [];

/** Register a driver. Re-registering an id replaces the old one and makes it the newest (highest precedence). */
export function registerDriver(driver: Driver): void {
  unregisterDriver(driver.id);
  registered.push(driver);
}

export function unregisterDriver(id: string): void {
  const i = registered.findIndex((d) => d.id === id);
  if (i >= 0) registered.splice(i, 1);
}

/** Registered (non-native) drivers, oldest first. */
export function listDrivers(): Driver[] {
  return registered.slice();
}

/**
 * Driver for a control, or null when none claims it. A library driver only applies to controls of
 * its own `lib`; the native driver handles native controls plus radio / checkbox inputs of any library.
 */
export function getDriver(control: Control): Driver | null {
  for (let i = registered.length - 1; i >= 0; i--) {
    const d = registered[i]!;
    if (d.lib === control.lib && d.kinds.includes(control.kind) && d.match(control)) return d;
  }
  return nativeDriver.match(control) ? nativeDriver : null;
}
