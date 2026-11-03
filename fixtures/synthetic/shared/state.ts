// Tiny helper for the fixture contract: window.__fixtureState() returns the form model as plain JSON.
// Normalisation rules: dates stay 'YYYY-MM' / 'YYYY-MM-DD', files -> file names, multi-selects -> arrays,
// unchecked checkbox -> false, empty fields -> ''. Select / radio values are reported as the *visible label*
// of the chosen option ('' while the placeholder is selected), so expected.json stays readable.

export type FixtureState = Record<string, unknown>;

declare global {
  interface Window {
    __fixtureState: () => FixtureState;
  }
}

export type Bound = HTMLElement | HTMLElement[];

function labelText(input: HTMLInputElement): string {
  const label = input.labels?.[0];
  return (label?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Normalised value of one control (or of a radio group when given an array of radios). */
export function readControl(bound: Bound): unknown {
  if (Array.isArray(bound)) {
    const checked = (bound as HTMLInputElement[]).find((r) => r.checked);
    return checked ? labelText(checked) : '';
  }
  const el = bound;
  if (el instanceof HTMLSelectElement) {
    if (el.multiple) return Array.from(el.selectedOptions).map((o) => (o.textContent ?? '').trim());
    const opt = el.selectedOptions[0];
    return !opt || opt.value === '' ? '' : (opt.textContent ?? '').trim();
  }
  if (el instanceof HTMLTextAreaElement) return el.value;
  if (el instanceof HTMLInputElement) {
    if (el.type === 'checkbox') return el.checked;
    if (el.type === 'file') return Array.from(el.files ?? []).map((f) => f.name);
    return el.value;
  }
  if (el.isContentEditable) return (el.textContent ?? '').trim();
  return (el.textContent ?? '').trim();
}

/** Ordered registry of `stateKey -> control`, snapshot into a plain object. */
export class StateRegistry {
  private entries: Array<[string, Bound]> = [];
  add(key: string, bound: Bound): void {
    this.entries.push([key, bound]);
  }
  snapshot(): FixtureState {
    const out: FixtureState = {};
    for (const [key, bound] of this.entries) out[key] = readControl(bound);
    return out;
  }
}

export function installFixtureState(fn: () => FixtureState): void {
  window.__fixtureState = fn;
}
