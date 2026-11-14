// @vitest-environment node
// Resume content must never reach logcat, the console or the network. These checks read the source from disk.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../..', import.meta.url));
const appSrc = join(repo, 'mobile/app/src');
const javaDir = join(repo, 'mobile/android/app/src/main/java/app/raf/dev');

function walk(dir: string, exts: RegExp): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...walk(path, exts));
    else if (exts.test(name)) out.push(path);
  }
  return out;
}

/** Source without comments and string contents, so a word in a comment or a message does not count. */
function code(text: string): string {
  return text
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:\\])\/\/.*$/gm, '$1')
    .replace(/'(?:\\.|[^'\\\n])*'|"(?:\\.|[^"\\\n])*"|`(?:\\.|[^`\\])*`/g, '""');
}

function offenders(files: string[], pattern: RegExp): string[] {
  return files.filter((f) => pattern.test(code(readFileSync(f, 'utf8')))).map((f) => relative(repo, f));
}

const tsFiles = () => walk(appSrc, /\.(ts|tsx)$/);
const javaFiles = () => walk(javaDir, /\.java$/);

/** The argument text of every `call.reject(...)`, matched to its closing parenthesis. */
function rejectArguments(source: string): string[] {
  const args: string[] = [];
  const start = /\bcall\.reject\(/g;
  let m: RegExpExecArray | null;
  while ((m = start.exec(source))) {
    let depth = 1;
    let i = m.index + m[0].length;
    let inString = false;
    for (; i < source.length && depth > 0; i += 1) {
      const c = source[i];
      if (inString) {
        if (c === '\\') i += 1;
        else if (c === '"') inString = false;
      } else if (c === '"') inString = true;
      else if (c === '(') depth += 1;
      else if (c === ')') depth -= 1;
    }
    args.push(source.slice(m.index + m[0].length, i - 1));
  }
  return args;
}

describe('privacy guards', () => {
  it('no console.* call in mobile/app/src', () => {
    expect(offenders(tsFiles(), /\bconsole\s*\.\s*\w+/)).toEqual([]);
  });

  it('no fetch, XMLHttpRequest or WebSocket in mobile/app/src', () => {
    expect(offenders(tsFiles(), /\bfetch\s*\(|\bXMLHttpRequest\b|\bWebSocket\b|\bsendBeacon\b|\bEventSource\b/)).toEqual([]);
  });

  it('capacitor.config.json keeps loggingBehavior "none"', () => {
    const config = JSON.parse(readFileSync(join(repo, 'mobile/capacitor.config.json'), 'utf8'));
    expect(config.loggingBehavior).toBe('none');
  });

  it('the Java plugins never import android.util.Log', () => {
    const files = javaFiles();
    expect(files.map((f) => relative(javaDir, f)).sort()).toEqual(
      expect.arrayContaining(['DocumentSaverPlugin.java', 'MainActivity.java', 'ProfileVaultPlugin.java']),
    );
    expect(offenders(files, /\bandroid\.util\.Log\b|\bLog\.[deivw]\s*\(|\bSystem\.(out|err)\b|printStackTrace/)).toEqual([]);
  });

  it('ProfileVaultPlugin and DocumentSaverPlugin put no call data into reject messages', () => {
    for (const name of ['ProfileVaultPlugin.java', 'DocumentSaverPlugin.java']) {
      const source = readFileSync(join(javaDir, name), 'utf8');
      const args = rejectArguments(source);
      expect(args.length, name).toBeGreaterThan(0);
      for (const arg of args) {
        // Allowed: string literals, UPPER_CASE constants, the caught exception `e` and its class name.
        const rest = arg
          .replace(/"(?:\\.|[^"\\])*"/g, '')
          .replace(/\be\.getClass\(\)\.getSimpleName\(\)/g, '');
        const words = rest.match(/[A-Za-z_]\w*/g) ?? [];
        const bad = words.filter((w) => w !== 'e' && w !== 'null' && !/^[A-Z][A-Z0-9_]*$/.test(w));
        expect(bad, `${name}: call.reject(${arg})`).toEqual([]);
      }
    }
  });

  it('DocumentSaverPlugin keeps the export out of the call that Android saves with the activity, and lets the call go', () => {
    // Capacitor writes the data of a call started with startActivityForResult into the activity's saved state (a Bundle
    // that leaves the app for system_server) every time the app goes to the background, until the call is released.
    const source = code(readFileSync(join(javaDir, 'DocumentSaverPlugin.java'), 'utf8'));
    const save = source.slice(source.indexOf('public void save('), source.indexOf('private void saveResult('));
    const removeAt = save.search(/call\.getData\(\)\.remove\(\s*""\s*\)/);
    expect(removeAt, 'the base64 data is removed from the call data').toBeGreaterThan(-1);
    expect(removeAt, 'before the picker starts').toBeLessThan(save.indexOf('startActivityForResult('));
    const result = source.slice(source.indexOf('private void saveResult('));
    expect(result).not.toMatch(/call\.getString\(\s*""\s*\)/);
    expect(result).toMatch(/bridge\.releaseCall\(\s*call\s*\)|getBridge\(\)\.releaseCall\(\s*call\s*\)/);
  });

  it('IncomingFilePlugin never logs, never touches a Bundle or saved state, and rejects without call data', () => {
    const raw = readFileSync(join(javaDir, 'IncomingFilePlugin.java'), 'utf8');
    const source = code(raw);
    expect(raw).toMatch(/@CapacitorPlugin\(\s*name\s*=\s*"IncomingFile"\s*\)/);
    expect(source).not.toMatch(/\bandroid\.util\.Log\b|\bLog\.[deivw]\s*\(|\bSystem\.(out|err)\b|printStackTrace/);
    expect(source).not.toMatch(/\bBundle\b|putByteArray|InstanceState|startActivityForResult|setKeepAlive|saveCall/);
    // Events are never kept for a listener that is not there yet: the JS side calls take() itself.
    for (const m of source.matchAll(/notifyListeners\(([^;]*)\);/g)) {
      expect(m[1], 'notifyListeners without retaining the event').toMatch(/,\s*false\s*\)?\s*$/);
    }
    expect(source).toMatch(/notifyListeners\(/);
    for (const arg of rejectArguments(raw)) {
      const rest = arg.replace(/"(?:\\.|[^"\\])*"/g, '');
      const words = rest.match(/[A-Za-z_]\w*/g) ?? [];
      expect(words.filter((w) => !/^[A-Z][A-Z0-9_]*$/.test(w)), `call.reject(${arg})`).toEqual([]);
    }
    // The slot is cleared before take() resolves, and the executor and bytes go with the activity.
    const take = source.slice(source.indexOf('public void take('));
    const takeBody = take.slice(0, take.indexOf('\n    }'));
    expect(takeBody.search(/\bclear\w*\(|bytes\s*=\s*null/)).toBeGreaterThan(-1);
    expect(takeBody.search(/\bclear\w*\(|bytes\s*=\s*null/)).toBeLessThan(takeBody.indexOf('call.resolve('));
    const destroy = source.slice(source.indexOf('handleOnDestroy('));
    expect(destroy.slice(0, destroy.indexOf('\n    }'))).toMatch(/shutdownNow\(\)/);
  });

  it('IncomingFilePlugin reads on its executor and checks the size before and while reading', () => {
    const source = code(readFileSync(join(javaDir, 'IncomingFilePlugin.java'), 'utf8'));
    expect(source).toMatch(/Executors\.newSingleThreadExecutor\(\)/);
    expect(source).toMatch(/executor\.(submit|execute)\(/);
    expect(source).toMatch(/MAX_BYTES\s*=\s*10L?\s*\*\s*1024\s*\*\s*1024/);
    expect(source).toMatch(/OpenableColumns\.SIZE/);
    expect(source).toMatch(/OpenableColumns\.DISPLAY_NAME/);
    // The size the provider reports is checked before the stream is opened.
    const sizeCheck = source.search(/size\s*>\s*MAX_BYTES/);
    const open = source.indexOf('openInputStream(');
    expect(sizeCheck).toBeGreaterThan(-1);
    expect(sizeCheck).toBeLessThan(open);
    // The stream is read in 64 KiB chunks and abandoned once it passes the cap.
    expect(source).toMatch(/new byte\[\s*64\s*\*\s*1024\s*\]/);
    const afterOpen = source.slice(open);
    expect(afterOpen).toMatch(/>\s*MAX_BYTES/);
    // Results go back to the main thread; nothing in the read touches the slot directly.
    expect(source).toMatch(/new Handler\(\s*Looper\.getMainLooper\(\)\s*\)|runOnUiThread\(/);
    for (const reason of ['too_large', 'wrong_type', 'empty', 'unreadable']) expect(readFileSync(join(javaDir, 'IncomingFilePlugin.java'), 'utf8')).toContain(`"${reason}"`);
  });

  it('IncomingFilePlugin does not take the launch intent again when the app is reopened from Recents', () => {
    const source = code(readFileSync(join(javaDir, 'IncomingFilePlugin.java'), 'utf8'));
    const load = source.slice(source.indexOf('public void load('));
    const body = load.slice(0, load.indexOf('\n    }'));
    const flag = body.search(/FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY/);
    expect(flag, 'load() checks FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY').toBeGreaterThan(-1);
    expect(flag, 'before it accepts the intent').toBeLessThan(body.indexOf('accept('));
    // BridgeActivity.load() passes the launch intent to handleOnNewIntent as well; load() has already decided on it.
    const onNew = source.slice(source.indexOf('void handleOnNewIntent('));
    const onNewBody = onNew.slice(0, onNew.indexOf('\n    }'));
    const same = onNewBody.search(/intent\s*==\s*getActivity\(\)\.getIntent\(\)/);
    expect(same, 'handleOnNewIntent skips the launch intent').toBeGreaterThan(-1);
    expect(same).toBeLessThan(onNewBody.indexOf('accept('));
  });

  it('the manifest opens only PDF and .docx, over content URIs, without BROWSABLE', () => {
    const manifest = readFileSync(join(repo, 'mobile/android/app/src/main/AndroidManifest.xml'), 'utf8');
    const filters = [...manifest.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map((m) => m[1]!);
    const view = filters.find((f) => f.includes('android.intent.action.VIEW'));
    const send = filters.find((f) => f.includes('android.intent.action.SEND"'));
    expect(view, 'a VIEW filter').toBeDefined();
    expect(send, 'a SEND filter').toBeDefined();
    const mimes = (f: string) => [...f.matchAll(/android:mimeType="([^"]+)"/g)].map((m) => m[1]).sort();
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    expect(mimes(view!)).toEqual(allowed);
    expect(mimes(send!)).toEqual(allowed);
    expect([...view!.matchAll(/android:scheme="([^"]+)"/g)].map((m) => m[1])).toEqual(['content']);
    expect(send!).not.toMatch(/android:scheme=/);
    expect(manifest).not.toMatch(/BROWSABLE|SEND_MULTIPLE|\*\/\*|octet-stream|android:scheme="file"/);
    const permissions = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((m) => m[1]);
    expect(permissions).toEqual(['android.permission.INTERNET']);
  });

  describe('fill browser', () => {
    const fillFiles = [
      'FillBrowserPlugin.java', 'FillBrowserHost.java', 'PageWebViewClient.java', 'PageChromeClient.java',
      'FrameRegistry.java', 'NavigationPolicy.java', 'FabView.java', 'ChooserStreamProvider.java',
      'WebViewSupport.java', 'DemoPathHandler.java',
    ];
    const read = (name: string) => readFileSync(join(javaDir, name), 'utf8');
    /** Body of the first method whose signature contains `signature`, up to its closing brace at 4 spaces. */
    const method = (source: string, signature: string) => {
      const at = source.indexOf(signature);
      expect(at, signature).toBeGreaterThan(-1);
      const rest = source.slice(at);
      return rest.slice(0, rest.indexOf('\n    }'));
    };

    it('the fill browser classes exist and never import android.util.Log', () => {
      const names = javaFiles().map((f) => relative(javaDir, f));
      expect(names).toEqual(expect.arrayContaining(fillFiles));
      const files = fillFiles.map((n) => join(javaDir, n));
      expect(offenders(files, /\bandroid\.util\.Log\b|\bLog\.[deivw]\s*\(|\bSystem\.(out|err)\b|printStackTrace/)).toEqual([]);
    });

    it('page console messages never reach logcat', () => {
      const body = code(method(read('PageChromeClient.java'), 'boolean onConsoleMessage('));
      expect(body).toMatch(/return\s+true\s*;/);
      expect(body).not.toMatch(/return\s+(false|super)/);
    });

    it('SSL errors are always refused, never proceeded', () => {
      expect(offenders(javaFiles(), /\.proceed\s*\(/)).toEqual([]);
      const body = code(method(read('PageWebViewClient.java'), 'void onReceivedSslError('));
      expect(body).toMatch(/handler\.cancel\(\s*\)/);
      expect(body).not.toMatch(/super\.onReceivedSslError/);
    });

    it('no JavaScript interface, no eval, no debugging switch, no file or mixed-content holes, no direct call', () => {
      const banned =
        /\baddJavascriptInterface\b|\bevaluateJavascript\b|\bsetWebContentsDebuggingEnabled\b|setAllowFileAccess\(\s*true|setAllowFileAccessFromFileURLs\(\s*true|setAllowUniversalAccessFromFileURLs\(\s*true|MIXED_CONTENT_ALWAYS_ALLOW|MIXED_CONTENT_COMPATIBILITY_MODE|\bACTION_CALL\b/;
      expect(offenders(javaFiles(), banned)).toEqual([]);
      const host = code(read('FillBrowserHost.java'));
      expect(host).toMatch(/setAllowFileAccess\(\s*false\s*\)/);
      expect(host).toMatch(/setAllowUniversalAccessFromFileURLs\(\s*false\s*\)/);
      expect(host).toMatch(/MIXED_CONTENT_NEVER_ALLOW/);
      expect(host).toMatch(/setSupportMultipleWindows\(\s*false\s*\)/);
    });

    it('page permission requests are denied', () => {
      const chrome = code(read('PageChromeClient.java'));
      expect(code(method(read('PageChromeClient.java'), 'void onPermissionRequest('))).toMatch(/\.deny\(\s*\)/);
      expect(chrome).not.toMatch(/\.grant\(/);
      expect(code(method(read('PageChromeClient.java'), 'void onGeolocationPermissionsShowPrompt('))).toMatch(
        /\.invoke\(\s*\w+\s*,\s*false\s*,\s*false\s*\)/,
      );
    });

    it('FillBrowserPlugin puts no call data into reject messages', () => {
      const source = read('FillBrowserPlugin.java');
      const args = rejectArguments(source);
      expect(args.length).toBeGreaterThan(0);
      for (const arg of args) {
        const rest = arg.replace(/"(?:\\.|[^"\\])*"/g, '');
        const words = rest.match(/[A-Za-z_]\w*/g) ?? [];
        expect(words.filter((w) => !/^[A-Z][A-Z0-9_]*$/.test(w)), `call.reject(${arg})`).toEqual([]);
      }
      for (const m of source.matchAll(/\bcall\.reject\(\s*"([^"]*)"/g)) {
        expect(['no_browser', 'bad_args', 'not_found', 'failed']).toContain(m[1]);
      }
    });

    it('the chooser provider is not exported and network security trusts system anchors only', () => {
      const manifest = readFileSync(join(repo, 'mobile/android/app/src/main/AndroidManifest.xml'), 'utf8');
      const permissions = [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((m) => m[1]);
      expect(permissions).toEqual(['android.permission.INTERNET']);
      const provider = [...manifest.matchAll(/<provider\b[^>]*>/g)].map((m) => m[0]).find((p) => p.includes('ChooserStreamProvider'));
      expect(provider, 'the chooser provider is declared').toBeDefined();
      expect(provider!).toMatch(/android:exported="false"/);
      expect(provider!).toMatch(/android:authorities="\$\{applicationId\}\.chooser"/);
      expect(provider!).not.toMatch(/grantUriPermissions="true"/);
      expect(manifest).toMatch(/android:networkSecurityConfig="@xml\/network_security_config"/);
      const nsc = readFileSync(join(repo, 'mobile/android/app/src/main/res/xml/network_security_config.xml'), 'utf8');
      const sources = [...nsc.matchAll(/<certificates\s+src="([^"]+)"/g)].map((m) => m[1]);
      expect(sources).toEqual(['system']);
      expect(nsc).not.toMatch(/overridePins|debug-overrides|src="user"/);
    });

    it('the chooser provider never writes to disk', () => {
      const source = code(read('ChooserStreamProvider.java'));
      expect(source).toMatch(/createReliablePipe\(/);
      expect(source).not.toMatch(/\bFileOutputStream\b|\bgetCacheDir\b|\bgetFilesDir\b|\bcreateTempFile\b|\bRandomAccessFile\b/);
    });
  });

  it('MainActivity saves only a boolean about the incoming file', () => {
    const raw = readFileSync(join(javaDir, 'MainActivity.java'), 'utf8');
    const source = code(raw);
    expect(source).toMatch(/registerPlugin\(\s*IncomingFilePlugin\.class\s*\)/);
    expect(raw).toMatch(/KEY_INCOMING_HANDLED\s*=\s*"raf\.incoming\.handled"/);
    const save = source.slice(source.indexOf('onSaveInstanceState('));
    const body = save.slice(0, save.indexOf('\n    }'));
    const puts = [...body.matchAll(/outState\.(put\w+)\(/g)].map((m) => m[1]);
    expect(puts).toEqual(['putBoolean']);
    expect(body).toMatch(/outState\.putBoolean\(\s*KEY_INCOMING_HANDLED\s*,\s*incomingHandled\s*\)/);
    expect(source).not.toMatch(/putByteArray|putString|putParcelable|putSerializable|getIntent\(\)\.get/);
  });
});
