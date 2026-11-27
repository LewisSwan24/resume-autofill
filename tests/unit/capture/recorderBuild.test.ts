// @vitest-environment node
// The recorder needs the debugger, which a store build must never ask for. Only a build in recorder mode
// (`pnpm build:recorder`) has it, and WXT writes that build to a folder of its own, .output/chrome-mv3-recorder.
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import config from '../../../wxt.config';

type Info = { name: string; inputPath: string; type: string };
type ManifestFn = (env: { mode: string; browser: string }) => { permissions?: string[] };
type FoundHook = (wxt: { config: { mode: string } }, infos: Info[]) => void;

const manifest = (mode: string) => (config.manifest as unknown as ManifestFn)({ mode, browser: 'chrome' });
const found = (mode: string): string[] => {
  const infos: Info[] = ['background', 'sidepanel', 'recorder'].map((name) => ({ name, inputPath: `${name}.ts`, type: 'unlisted-page' }));
  ((config.hooks as Record<string, unknown>)['entrypoints:found'] as FoundHook)({ config: { mode } }, infos);
  return infos.map((i) => i.name);
};

describe('the recorder build switch', () => {
  it('leaves the debugger, scripting and the recorder page out of every other build', () => {
    for (const mode of ['production', 'development']) {
      expect(manifest(mode).permissions).toEqual(['storage', 'unlimitedStorage', 'sidePanel', 'webNavigation']);
      expect(found(mode)).toEqual(['background', 'sidepanel']);
    }
  });

  it('adds them in recorder mode', () => {
    expect(manifest('recorder').permissions).toEqual(['storage', 'unlimitedStorage', 'sidePanel', 'webNavigation', 'debugger', 'scripting']);
    expect(found('recorder')).toEqual(['background', 'sidepanel', 'recorder']);
  });

  it('is built by a script of its own, and the store build script stays as it was', () => {
    const scripts = (JSON.parse(readFileSync('package.json', 'utf8')) as { scripts: Record<string, string> }).scripts;
    expect(scripts['build:recorder']).toBe('wxt build --mode recorder');
    expect(scripts.build).toBe('wxt build');
    expect(scripts.zip).toBe('wxt zip');
  });
});
