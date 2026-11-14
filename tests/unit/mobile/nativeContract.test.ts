// @vitest-environment node
// The FillBrowser plugin (Java) and its TypeScript contract (mobile/app/src/browser/native.ts) must name the same
// methods and events. These checks read the Java source from disk.
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const javaDir = join(repo, 'mobile/android/app/src/main/java/app/raf/dev');
const nativeTs = join(repo, 'mobile/app/src/browser/native.ts');

/** native.ts must carry the same lists; checked below once it exists. */
const METHODS = [
  'capabilities', 'open', 'close', 'setVisible', 'setInsets', 'setTheme', 'loadUrl', 'navigate', 'post',
  'setPageCover', 'setFab', 'answerFileChooser', 'openExternal', 'clearSiteData', 'takeCrashNotice',
];
const EVENTS = [
  'message', 'frameGone', 'navigation', 'progress', 'title', 'loadError', 'crashed', 'external', 'download',
  'fileChooser', 'permission', 'keyboard', 'pageArea', 'fabTap', 'fabMoved', 'fabAction', 'scrimTap',
];

/** Source without comments, so a name in a comment does not count. */
function stripComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\"])\/\/.*$/gm, '$1');
}

/** The fill browser's own classes (the older plugins keep their own events). */
const FILL_FILES = [
  'FillBrowserPlugin.java', 'FillBrowserHost.java', 'PageWebViewClient.java', 'PageChromeClient.java',
  'FrameRegistry.java', 'NavigationPolicy.java', 'FabView.java', 'ChooserStreamProvider.java', 'WebViewSupport.java',
  'DemoPathHandler.java',
];

function javaSources(): string {
  return FILL_FILES.map((n) => stripComments(readFileSync(join(javaDir, n), 'utf8'))).join('\n');
}

const sorted = (xs: Iterable<string>) => [...new Set(xs)].sort();

describe('FillBrowser native contract', () => {
  it('the plugin is registered under the name "FillBrowser"', () => {
    const source = readFileSync(join(javaDir, 'FillBrowserPlugin.java'), 'utf8');
    expect(source).toMatch(/@CapacitorPlugin\(\s*name\s*=\s*"FillBrowser"\s*\)/);
    expect(stripComments(readFileSync(join(javaDir, 'MainActivity.java'), 'utf8'))).toMatch(
      /registerPlugin\(\s*FillBrowserPlugin\.class\s*\)/,
    );
  });

  it('every contract method is a @PluginMethod of FillBrowserPlugin, and nothing else is', () => {
    const source = stripComments(readFileSync(join(javaDir, 'FillBrowserPlugin.java'), 'utf8'));
    const found = [...source.matchAll(/@PluginMethod(?:\([^)]*\))?\s+public\s+void\s+(\w+)\s*\(\s*PluginCall\b/g)].map(
      (m) => m[1]!,
    );
    expect(sorted(found)).toEqual(sorted(METHODS));
  });

  it('every contract event is emitted with notifyListeners, and nothing else is', () => {
    const source = javaSources();
    const calls = [...source.matchAll(/notifyListeners\(\s*([^,]*),/g)].map((m) => m[1]!.trim());
    // Always a literal name, so this check sees every event.
    expect(calls.filter((c) => !/^"\w+"$/.test(c))).toEqual([]);
    expect(sorted(calls.map((c) => c.slice(1, -1)))).toEqual(sorted(EVENTS));
  });

  it.runIf(existsSync(nativeTs))('native.ts carries the same name lists', async () => {
    const mod = (await import(/* @vite-ignore */ pathToFileURL(nativeTs).href)) as {
      NATIVE_METHODS: readonly string[];
      NATIVE_EVENTS: readonly string[];
    };
    expect(sorted(mod.NATIVE_METHODS)).toEqual(sorted(METHODS));
    expect(sorted(mod.NATIVE_EVENTS)).toEqual(sorted(EVENTS));
  });

  it('the app survives the shared WebView renderer dying: the plugin answers the UI WebView with true and recreates', () => {
    // All WebViews of the app share one renderer; Capacitor returns false for the UI WebView unless a WebViewListener
    // says true, and false kills the process.
    // Added through the builder: Bridge.Builder.create() replaces the listener list after plugins load.
    const activity = stripComments(readFileSync(join(javaDir, 'MainActivity.java'), 'utf8'));
    expect(activity).toMatch(/bridgeBuilder\.addWebViewListener\(\s*FillBrowserPlugin\.crashListener\(this\)\s*\)/);
    const source = stripComments(readFileSync(join(javaDir, 'FillBrowserPlugin.java'), 'utf8'));
    expect(source).toMatch(/public boolean onRenderProcessGone\([^)]*\)\s*\{[\s\S]*?recreate[\s\S]*?return true;/);
  });
});
