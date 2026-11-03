// Trailing-edge debouncer for autosave: only the latest scheduled value is saved.
export const AUTOSAVE_DELAY_MS = 500;

export interface Autosaver<T> {
  /** (Re)start the timer; the previous pending value is discarded. */
  schedule(value: T): void;
  /** Save the pending value now (no-op when nothing is pending). */
  flush(): Promise<void>;
  /** Drop the pending value without saving. */
  cancel(): void;
  readonly pending: boolean;
}

export function createAutosaver<T>(
  save: (value: T) => Promise<unknown> | unknown,
  delayMs: number = AUTOSAVE_DELAY_MS,
): Autosaver<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let hasValue = false;
  let latest: T | undefined;

  const run = async () => {
    timer = null;
    if (!hasValue) return;
    const value = latest as T;
    hasValue = false;
    latest = undefined;
    await save(value);
  };

  return {
    schedule(value) {
      latest = value;
      hasValue = true;
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => void run(), delayMs);
    },
    async flush() {
      if (timer !== null) clearTimeout(timer);
      await run();
    },
    cancel() {
      if (timer !== null) clearTimeout(timer);
      timer = null;
      hasValue = false;
      latest = undefined;
    },
    get pending() {
      return hasValue;
    },
  };
}
