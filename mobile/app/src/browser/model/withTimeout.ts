// Copy of withTimeout / FrameTimeoutError from src/background/frames.ts, which imports wxt/browser and so cannot be
// imported by the mobile app. Follow-up: move the original into a platform-free module and delete this copy.

export class FrameTimeoutError extends Error {
  constructor(ms: number) {
    super(`No answer within ${ms} ms`);
    this.name = 'FrameTimeoutError';
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new FrameTimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
