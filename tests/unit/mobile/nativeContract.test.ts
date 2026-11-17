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

describe('ways-in and reminder plugins', () => {
  const nativeDir = join(repo, 'mobile/app/src/native');
  /** Java class, TS contract file, the METHODS / EVENTS export names, and the events the Java side emits. */
  const PLUGINS = [
    { name: 'IncomingIntent', java: 'IncomingIntentPlugin.java', ts: 'incomingIntent.ts', methods: 'INCOMING_INTENT_METHODS', events: 'INCOMING_INTENT_EVENTS' },
    { name: 'ClipboardPeek', java: 'ClipboardPeekPlugin.java', ts: 'clipboardPeek.ts', methods: 'CLIPBOARD_METHODS', events: 'CLIPBOARD_EVENTS' },
    { name: 'Reminders', java: 'RemindersPlugin.java', ts: 'reminders.ts', methods: 'REMINDERS_METHODS', events: 'REMINDERS_EVENTS' },
    { name: 'AppShortcuts', java: 'AppShortcutsPlugin.java', ts: 'appShortcuts.ts', methods: 'SHORTCUTS_METHODS', events: 'SHORTCUTS_EVENTS' },
    { name: 'BrowserRole', java: 'BrowserRolePlugin.java', ts: 'browserRole.ts', methods: 'BROWSER_ROLE_METHODS', events: 'BROWSER_ROLE_EVENTS' },
    // The resume keyboard.
    { name: 'ResumeKeyboard', java: 'ResumeKeyboardPlugin.java', ts: 'resumeKeyboard.ts', methods: 'RESUME_KEYBOARD_METHODS', events: 'RESUME_KEYBOARD_EVENTS' },
  ] as const;
  const javaOf = (file: string) => {
    const path = join(javaDir, file);
    expect(existsSync(path), file).toBe(true);
    return stripComments(readFileSync(path, 'utf8'));
  };
  const load = async (file: string) =>
    (await import(/* @vite-ignore */ pathToFileURL(join(nativeDir, file)).href)) as Record<string, readonly string[] | undefined>;

  it("each new plugin's @CapacitorPlugin name matches its registerPlugin name", () => {
    for (const p of PLUGINS) {
      const annotation = /@CapacitorPlugin\(\s*name\s*=\s*"(\w+)"/.exec(javaOf(p.java));
      expect(annotation?.[1], p.java).toBe(p.name);
      const ts = readFileSync(join(nativeDir, p.ts), 'utf8');
      expect([...ts.matchAll(/registerPlugin<\w+>\(\s*'(\w+)'\s*\)/g)].map((m) => m[1]), p.ts).toEqual([p.name]);
    }
  });

  it("each plugin's @PluginMethod set equals its TS METHODS list", async () => {
    for (const p of PLUGINS) {
      const found = [...javaOf(p.java).matchAll(/@PluginMethod(?:\([^)]*\))?\s+public\s+void\s+(\w+)\s*\(\s*PluginCall\b/g)].map((m) => m[1]!);
      const mod = await load(p.ts);
      expect(mod[p.methods], `${p.ts} ${p.methods}`).toBeDefined();
      expect(sorted(found), p.java).toEqual(sorted(mod[p.methods]!));
    }
  });

  it("each plugin's notifyListeners event names equal its TS EVENTS list", async () => {
    for (const p of PLUGINS) {
      const calls = [...javaOf(p.java).matchAll(/notifyListeners\(\s*([^,]*),/g)].map((m) => m[1]!.trim());
      expect(calls.filter((c) => !/^"\w+"$/.test(c)), p.java).toEqual([]);
      const mod = await load(p.ts);
      expect(sorted(calls.map((c) => c.slice(1, -1))), p.java).toEqual(sorted(mod[p.events] ?? []));
    }
    expect((await load('incomingIntent.ts')).INCOMING_INTENT_EVENTS).toEqual(['incomingIntent']);
    expect((await load('clipboardPeek.ts')).CLIPBOARD_EVENTS).toEqual(['focus']);
    expect((await load('resumeKeyboard.ts')).RESUME_KEYBOARD_EVENTS).toEqual(['stateChange']);
  });

  it('MainActivity registers all plugins before super.onCreate', () => {
    const source = javaOf('MainActivity.java');
    const onCreate = source.slice(source.indexOf('public void onCreate('));
    const superAt = onCreate.indexOf('super.onCreate(');
    expect(superAt).toBeGreaterThan(-1);
    const registered = [...onCreate.slice(0, superAt).matchAll(/registerPlugin\(\s*(\w+)\.class\s*\)/g)].map((m) => m[1]!);
    expect(sorted(registered)).toEqual(sorted([
      'ProfileVaultPlugin', 'DocumentSaverPlugin', 'IncomingFilePlugin', 'FillBrowserPlugin',
      'IncomingIntentPlugin', 'ClipboardPeekPlugin', 'RemindersPlugin', 'AppShortcutsPlugin', 'BrowserRolePlugin',
      'ResumeKeyboardPlugin', 'PrintBridgePlugin',
    ]));
    expect([...source.matchAll(/registerPlugin\(/g)]).toHaveLength(11);
  });

  it('window focus reaches ClipboardPeekPlugin through the bridge', () => {
    const source = javaOf('MainActivity.java');
    const focus = source.slice(source.indexOf('void onWindowFocusChanged('));
    const body = focus.slice(0, focus.indexOf('\n    }'));
    expect(body).toMatch(/super\.onWindowFocusChanged\(/);
    expect(body).toMatch(/getPlugin\(\s*"ClipboardPeek"\s*\)/);
    expect(body).toMatch(/notifyFocus\(\s*\)/);
  });

  it('window focus also reaches ResumeKeyboardPlugin, which emits stateChange with the status', () => {
    const source = javaOf('MainActivity.java');
    const focus = source.slice(source.indexOf('void onWindowFocusChanged('));
    const body = focus.slice(0, focus.indexOf('\n    }'));
    expect(body).toMatch(/getPlugin\(\s*"ResumeKeyboard"\s*\)/);
    expect(body).toMatch(/instanceof\s+ResumeKeyboardPlugin/);
    expect(body).toMatch(/notifyStateChange\(\s*\)/);
    const plugin = javaOf('ResumeKeyboardPlugin.java');
    const notify = plugin.slice(plugin.indexOf('void notifyStateChange('));
    expect(notify.slice(0, notify.indexOf('\n    }'))).toMatch(/notifyListeners\(\s*"stateChange"\s*,/);
  });

  it('the keyboard status names the service by its component, which is RESUME_KEYBOARD_ID', async () => {
    const plugin = javaOf('ResumeKeyboardPlugin.java');
    expect(plugin).toMatch(/new\s+ComponentName\(\s*\w+\s*,\s*ResumeKeyboardService\.class\s*\)\.flattenToShortString\(\)/);
    const mod = (await import(/* @vite-ignore */ pathToFileURL(join(nativeDir, 'resumeKeyboard.ts')).href)) as { RESUME_KEYBOARD_ID: string };
    const manifest = readFileSync(join(repo, 'mobile/android/app/src/main/AndroidManifest.xml'), 'utf8');
    expect(manifest).toContain('android:name=".keyboard.ResumeKeyboardService"');
    expect(mod.RESUME_KEYBOARD_ID).toBe('app.raf.dev/.keyboard.ResumeKeyboardService');
  });
});
