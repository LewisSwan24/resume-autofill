// @vitest-environment node
// The recorder needs the debugger, which a store build must never ask for. Only RAF_RECORDER=1 builds it, into a
// folder of its own so that no test or release picks that build up by mistake.
import { afterEach, describe, expect, it } from 'vitest';
import config from '../../../wxt.config';

type Info = { name: string; inputPath: string; type: string };
type ManifestFn = (env: unknown) => { permissions?: string[] };
type FoundHook = (wxt: unknown, infos: Info[]) => void;

const manifest = (): { permissions?: string[] } => (config.manifest as unknown as ManifestFn)({ mode: 'production', browser: 'chrome' });
const found = (): string[] => {
  const infos: Info[] = ['background', 'sidepanel', 'recorder'].map((name) => ({ name, inputPath: `${name}.ts`, type: 'unlisted-page' }));
  ((config.hooks as Record<string, unknown>)['entrypoints:found'] as FoundHook)({}, infos);
  return infos.map((i) => i.name);
};

afterEach(() => {
  delete process.env.RAF_RECORDER;
});

describe('the recorder build switch', () => {
  it('leaves the debugger, scripting and the recorder page out of a normal build', () => {
    expect(manifest().permissions).toEqual(['storage', 'unlimitedStorage', 'sidePanel', 'webNavigation']);
    expect(found()).toEqual(['background', 'sidepanel']);
  });

  it('adds them with RAF_RECORDER=1, built apart from the normal build', () => {
    process.env.RAF_RECORDER = '1';
    expect(manifest().permissions).toEqual(['storage', 'unlimitedStorage', 'sidePanel', 'webNavigation', 'debugger', 'scripting']);
    expect(found()).toEqual(['background', 'sidepanel', 'recorder']);
  });

  it('writes a recorder build to a folder of its own', async () => {
    const { recorderBuild } = await import('../../../src/capture/build');
    expect(recorderBuild({}).outDirTemplate).toBeUndefined();
    expect(recorderBuild({ RAF_RECORDER: '1' }).outDirTemplate).toBe('{{browser}}-mv{{manifestVersion}}-recorder');
  });
});
