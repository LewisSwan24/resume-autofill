// The page engine bundle (mobile/inject/vite.config.ts) shares the page's JavaScript world on Android WebView, so
// zod's two config globals (__zod_globalConfig, __zod_globalRegistry) must stay inside the IIFE: the page must not
// see them, nor be able to change the config the bridge validation runs with.
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZOD_GLOBAL, ZOD_INTRO, keepZodGlobalsLocal } from '../../../../mobile/inject/zodGlobals';

const require = createRequire(import.meta.url);
const zodCore = join(dirname(require.resolve('zod/package.json')), 'v4', 'core');
type Transform = (code: string, id: string) => { code: string } | null;

function transformed(file: string): string {
  const id = join(zodCore, file);
  const out = (keepZodGlobalsLocal().transform as Transform)(readFileSync(id, 'utf8'), id);
  return out ? out.code : readFileSync(id, 'utf8');
}

describe('engine bundle keeps zod globals local', () => {
  it.each(['core.js', 'registries.js'])('zod %s no longer touches globalThis', (file) => {
    const code = transformed(file);
    expect(code).not.toMatch(/\bglobalThis\b/);
    expect(code).toContain(ZOD_GLOBAL);
  });

  it('leaves other modules alone', () => {
    expect((keepZodGlobalsLocal().transform as Transform)('globalThis.x = 1', '/repo/src/engine/scan.ts')).toBeNull();
  });

  it('the IIFE intro declares the local holder with jitless set, and the build uses both', () => {
    expect(ZOD_INTRO).toContain(`var ${ZOD_GLOBAL}=`);
    expect(ZOD_INTRO).toContain('jitless:true');
    expect(ZOD_INTRO).not.toMatch(/globalThis|window/);
    const config = readFileSync(join(process.cwd(), 'mobile', 'inject', 'vite.config.ts'), 'utf8');
    expect(config).toMatch(/plugins:\s*\[keepZodGlobalsLocal\(\)\]/);
    expect(config).toMatch(/intro:\s*ZOD_INTRO,/);
  });
});
