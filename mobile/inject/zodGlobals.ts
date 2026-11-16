// zod keeps two config objects on globalThis (__zod_globalConfig, __zod_globalRegistry). The page engine runs in the
// page's own JavaScript world on Android WebView, so in the bundle those references point at a holder local to the
// IIFE instead: the page neither sees them nor can change the config the bridge validation runs with.
import type { Plugin } from 'vite';

/** Name of the IIFE-local holder that stands in for globalThis inside zod's core. */
export const ZOD_GLOBAL = '__rafZodGlobal';

/** Declared in the IIFE intro, before any module runs; jitless keeps zod from probing `Function('')` (page CSP). */
export const ZOD_INTRO = `var ${ZOD_GLOBAL}={__zod_globalConfig:{jitless:true}};`;

const ZOD_CORE = /[\\/]zod[\\/]v4[\\/]core[\\/](core|registries)\.js$/;

export function keepZodGlobalsLocal(): Plugin {
  return {
    name: 'raf-zod-globals-local',
    transform(code: string, id: string) {
      if (!ZOD_CORE.test(id)) return null;
      return { code: code.replace(/\bglobalThis\b/g, ZOD_GLOBAL), map: null };
    },
  };
}
