// The recorder exists only in a build made with RAF_RECORDER=1. It reads a tab's network through the debugger and
// its frames through scripting, two permissions a store build must never ask for.
type Env = Record<string, string | undefined>;

export const RECORDER_ENTRYPOINT = 'recorder';
export const RECORDER_PERMISSIONS = ['debugger', 'scripting'];

export const recorderOn = (env: Env): boolean => env.RAF_RECORDER === '1';

/** Build options for a recorder build: its own output folder, so no test or release picks it up by mistake. */
export function recorderBuild(env: Env): { outDirTemplate?: string } {
  return recorderOn(env) ? { outDirTemplate: '{{browser}}-mv{{manifestVersion}}-recorder' } : {};
}

export function recorderPermissions(permissions: string[], env: Env): string[] {
  return recorderOn(env) ? [...permissions, ...RECORDER_PERMISSIONS] : permissions;
}

/** Drops the recorder page from what a build found, unless this is a recorder build. Changes `infos` in place. */
export function dropRecorder(infos: { name: string }[], env: Env): void {
  if (recorderOn(env)) return;
  for (let i = infos.length - 1; i >= 0; i--) if (infos[i]!.name === RECORDER_ENTRYPOINT) infos.splice(i, 1);
}
