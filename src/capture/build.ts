// The recorder exists only in a build made in recorder mode (`pnpm build:recorder`, which WXT writes to
// .output/chrome-mv3-recorder). It reads a tab's network through the debugger and its frames through scripting, two
// permissions a store build must never ask for.
export const RECORDER_MODE = 'recorder';
export const RECORDER_ENTRYPOINT = 'recorder';
export const RECORDER_PERMISSIONS = ['debugger', 'scripting'];

export function recorderPermissions(permissions: string[], mode: string): string[] {
  return mode === RECORDER_MODE ? [...permissions, ...RECORDER_PERMISSIONS] : permissions;
}

/** Drops the recorder page from what a build found, unless this is a recorder build. Changes `infos` in place. */
export function dropRecorder(infos: { name: string }[], mode: string): void {
  if (mode === RECORDER_MODE) return;
  for (let i = infos.length - 1; i >= 0; i--) if (infos[i]!.name === RECORDER_ENTRYPOINT) infos.splice(i, 1);
}
