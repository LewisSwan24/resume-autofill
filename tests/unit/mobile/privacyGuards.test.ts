// @vitest-environment node
// Resume content must never reach logcat, the console or the network. These checks read the source from disk.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
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

  // ------------------------------------------------------------ manifest (ways in, reminders)

  const PERMISSIONS = [
    'android.permission.INTERNET', 'android.permission.POST_NOTIFICATIONS', 'android.permission.RECEIVE_BOOT_COMPLETED',
  ].sort();
  const permissionsOf = (manifest: string) =>
    [...manifest.matchAll(/<uses-permission android:name="([^"]+)"/g)].map((m) => m[1]!).sort();
  const mainManifest = () => readFileSync(join(repo, 'mobile/android/app/src/main/AndroidManifest.xml'), 'utf8');
  /** The intent filters of MainActivity only (receivers have their own). */
  const activityFilters = () => {
    const activity = /<activity\b[\s\S]*?<\/activity>/.exec(mainManifest())?.[0] ?? '';
    expect(activity).toContain('android:name=".MainActivity"');
    return [...activity.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map((m) => m[1]!);
  };
  const attr = (f: string, name: string) => [...f.matchAll(new RegExp(`android:${name}="([^"]+)"`, 'g'))].map((m) => m[1]!);
  const javaAt = (name: string) => readFileSync(join(javaDir, name), 'utf8');
  const debugJavaDir = join(repo, 'mobile/android/app/src/debug/java/app/raf/dev');
  /** Body of the first method whose signature contains `signature`, up to its closing brace at 4 spaces. */
  const bodyOf = (source: string, signature: string) => {
    const at = source.indexOf(signature);
    expect(at, signature).toBeGreaterThan(-1);
    const rest = source.slice(at);
    return rest.slice(0, rest.indexOf('\n    }'));
  };
  const constantRejects = (name: string, raw: string) => {
    for (const arg of rejectArguments(raw)) {
      const rest = arg.replace(/"(?:\\.|[^"\\])*"/g, '');
      const words = rest.match(/[A-Za-z_]\w*/g) ?? [];
      expect(words.filter((w) => !/^[A-Z][A-Z0-9_]*$/.test(w)), `${name}: call.reject(${arg})`).toEqual([]);
    }
  };
  const NEW_JAVA = [
    'IncomingIntents.java', 'IncomingIntentPlugin.java', 'ClipboardPeekPlugin.java', 'RemindersPlugin.java',
    'ReminderMath.java', 'ReminderStore.java', 'ReminderScheduler.java', 'ReminderReceiver.java', 'BootReceiver.java',
    'VaultCrypto.java', 'AppShortcutsPlugin.java', 'ShortcutRules.java', 'BrowserRolePlugin.java',
  ];

  it('file filters stay content-only without BROWSABLE; the one BROWSABLE filter is VIEW with only http and https, no host, path or mimeType', () => {
    const filters = activityFilters();
    const allowed = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
    const has = (f: string, action: string) => f.includes(`android:name="android.intent.action.${action}"`);
    const browsable = filters.filter((f) => f.includes('android.intent.category.BROWSABLE'));
    expect(browsable).toHaveLength(1);
    const web = browsable[0]!;
    expect(attr(web, 'name').filter((n) => n.includes('.action.'))).toEqual(['android.intent.action.VIEW']);
    expect(attr(web, 'scheme').sort()).toEqual(['http', 'https']);
    expect(web).not.toMatch(/android:(host|path|pathPrefix|pathPattern|pathAdvancedPattern|pathSuffix|port|mimeType|ssp\w*)=/);
    expect(web).not.toMatch(/autoVerify/);

    const fileView = filters.filter((f) => has(f, 'VIEW') && f !== web);
    expect(fileView).toHaveLength(1);
    expect(attr(fileView[0]!, 'scheme')).toEqual(['content']);
    expect(attr(fileView[0]!, 'mimeType').sort()).toEqual(allowed);
    const fileSend = filters.filter((f) => has(f, 'SEND') && f.includes('application/pdf'));
    expect(fileSend).toHaveLength(1);
    expect(attr(fileSend[0]!, 'mimeType').sort()).toEqual(allowed);
    expect(fileSend[0]!).not.toMatch(/android:scheme=|BROWSABLE/);
    expect(filters).toHaveLength(5); // launcher, file VIEW, file SEND, web VIEW, text SEND
    expect(mainManifest()).not.toMatch(/SEND_MULTIPLE|\*\/\*|octet-stream|android:scheme="file"/);
  });

  it('SEND text/plain filter has no BROWSABLE', () => {
    const text = activityFilters().filter((f) => f.includes('"text/plain"'));
    expect(text).toHaveLength(1);
    expect(text[0]!).toContain('android:name="android.intent.action.SEND"');
    expect(attr(text[0]!, 'mimeType')).toEqual(['text/plain']);
    expect(text[0]!).not.toMatch(/BROWSABLE|android:scheme=/);
  });

  it('the manifest asks only for INTERNET, POST_NOTIFICATIONS and RECEIVE_BOOT_COMPLETED', () => {
    const manifest = mainManifest();
    expect(permissionsOf(manifest)).toEqual(PERMISSIONS);
    expect(manifest).not.toMatch(/SCHEDULE_EXACT_ALARM|USE_EXACT_ALARM|READ_EXTERNAL|WRITE_EXTERNAL|READ_MEDIA|READ_CONTACTS|QUERY_ALL_PACKAGES/);
    expect(manifest).toMatch(/<meta-data\s+android:name="android\.app\.shortcuts"\s+android:resource="@xml\/shortcuts"\s*\/>/);
    // Browsers are looked up for 「用系统浏览器打开」 with a queries block, not QUERY_ALL_PACKAGES.
    const queries = /<queries>([\s\S]*?)<\/queries>/.exec(manifest)?.[1] ?? '';
    expect(queries).toContain('android.intent.action.VIEW');
    expect(queries).toContain('android.intent.category.BROWSABLE');
    expect(queries).toContain('android:scheme="https"');
  });

  it('ReminderReceiver is not exported; BootReceiver handles only its four actions', () => {
    const receivers = [...mainManifest().matchAll(/<receiver\b([^>]*?)(?:\/>|>([\s\S]*?)<\/receiver>)/g)].map((m) => ({
      attrs: m[1]!,
      body: m[2] ?? '',
    }));
    expect(receivers.map((r) => attr(r.attrs, 'name')[0]).sort()).toEqual(['.BootReceiver', '.ReminderReceiver']);
    const reminder = receivers.find((r) => r.attrs.includes('.ReminderReceiver'))!;
    expect(reminder.attrs).toMatch(/android:exported="false"/);
    expect(reminder.body).not.toMatch(/intent-filter/);
    const boot = receivers.find((r) => r.attrs.includes('.BootReceiver'))!;
    expect(boot.attrs).toMatch(/android:exported="true"/);
    const four = [
      'android.intent.action.BOOT_COMPLETED', 'android.intent.action.MY_PACKAGE_REPLACED',
      'android.intent.action.TIMEZONE_CHANGED', 'android.intent.action.TIME_SET',
    ];
    expect(attr(boot.body, 'name').sort()).toEqual([...four].sort());
    const source = code(javaAt('BootReceiver.java'));
    expect(source).toMatch(/goAsync\(\s*\)/);
    expect(source).toMatch(/ReminderScheduler\.rescheduleAll\(/);
    for (const action of ['ACTION_BOOT_COMPLETED', 'ACTION_MY_PACKAGE_REPLACED', 'ACTION_TIMEZONE_CHANGED', 'ACTION_TIME_CHANGED']) {
      expect(source).toContain(`Intent.${action}`);
    }
    // Reads nothing from the intent but its action.
    expect(source).not.toMatch(/\.get\w*Extra\w*\(|getData\(|getExtras\(/);
  });

  it('the new Java classes never import android.util.Log, call printStackTrace or System.out', () => {
    const files = [...NEW_JAVA.map((n) => join(javaDir, n)), join(debugJavaDir, 'DebugReminderReceiver.java')];
    for (const f of files) expect(existsSync(f), f).toBe(true);
    expect(offenders(files, /\bandroid\.util\.Log\b|\bLog\.[deivw]\s*\(|\bSystem\.(out|err)\b|printStackTrace/)).toEqual([]);
  });

  it('intents built by the reminder and shortcut code carry only recordId, open and entry ids', () => {
    const files = ['ReminderScheduler.java', 'ReminderReceiver.java', 'AppShortcutsPlugin.java', 'BootReceiver.java']
      .map((n) => ({ n, raw: javaAt(n) }))
      .concat([{ n: 'DebugReminderReceiver.java', raw: readFileSync(join(debugJavaDir, 'DebugReminderReceiver.java'), 'utf8') }]);
    const allowed = /^(?:"recordId"|"open"|(?:IncomingIntents\.)?EXTRA_RECORD_ID|(?:IncomingIntents\.)?EXTRA_OPEN)$/;
    let extras = 0;
    for (const { n, raw } of files) {
      const source = raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\"])\/\/.*$/gm, '$1');
      for (const m of source.matchAll(/\.putExtra\(\s*([^,]+),/g)) {
        extras += 1;
        expect(m[1]!.trim(), `${n}: putExtra(${m[1]}`).toMatch(allowed);
      }
      expect(source, n).not.toMatch(/\.putExtras\(|\.replaceExtras\(|setClipData\(|\.setDataAndType\(/);
    }
    expect(extras).toBeGreaterThan(0);
    const scheduler = javaAt('ReminderScheduler.java');
    expect(scheduler).toContain('"raf-reminder://"');
    expect(scheduler).toContain('"app.raf.dev.REMINDER"');
    // Every PendingIntent is immutable.
    const pending = [...code(scheduler).matchAll(/PendingIntent\.get\w+\(([^;]*)\);/g)].map((m) => m[1]!);
    expect(pending.length).toBeGreaterThan(0);
    for (const args of pending) expect(args).toMatch(/FLAG_IMMUTABLE/);
    expect(code(scheduler)).toMatch(/setWindow\(\s*AlarmManager\.RTC_WAKEUP\s*,/);
    expect(code(scheduler)).not.toMatch(/setExact\w*\(|setAlarmClock\(/);
    expect(code(scheduler)).toMatch(/VISIBILITY_PRIVATE/);
    expect(code(scheduler)).toMatch(/setPublicVersion\(/);
  });

  it('launcher shortcuts reach MainActivity through ShortcutActivity, which forwards only the action, recordId and open', () => {
    // A launcher starts every shortcut with NEW_TASK | CLEAR_TASK. Aimed straight at MainActivity that recreates it and
    // throws away an open page or a running import, so the shortcuts aim at a trampoline in a task of its own.
    const manifest = mainManifest();
    const block = /<activity\b[^>]*android:name="\.ShortcutActivity"[^>]*\/?>/.exec(manifest)?.[0] ?? '';
    expect(block).not.toBe('');
    expect(block).toContain('android:exported="false"');
    expect(block).toContain('android:taskAffinity=""');
    expect(block).toContain('android:excludeFromRecents="true"');
    expect(block).toContain('android:noHistory="true"');
    const source = code(javaAt('ShortcutActivity.java'));
    expect(source).toMatch(/new Intent\(this, MainActivity\.class\)/);
    expect(source).toMatch(/FLAG_ACTIVITY_NEW_TASK/);
    expect(source).not.toMatch(/FLAG_ACTIVITY_CLEAR_TASK|FLAG_ACTIVITY_CLEAR_TOP|\.putExtras\(|\.replaceExtras\(|setData\w*\(/);
    for (const m of source.matchAll(/\.putExtra\(\s*([^,]+),/g)) {
      expect(m[1]!.trim()).toMatch(/^(?:IncomingIntents\.)?EXTRA_(?:RECORD_ID|OPEN)$/);
    }
    expect(source).toMatch(/finish\(\)/);
    expect(code(javaAt('AppShortcutsPlugin.java'))).toMatch(/new Intent\(context, ShortcutActivity\.class\)/);
    expect(code(javaAt('AppShortcutsPlugin.java'))).not.toMatch(/new Intent\(context, MainActivity\.class\)/);
  });

  it('ReminderStore writes only through VaultCrypto', () => {
    for (const n of ['ReminderStore.java', 'ReminderScheduler.java', 'ReminderReceiver.java', 'BootReceiver.java', 'RemindersPlugin.java']) {
      expect(code(javaAt(n)), n).not.toMatch(/\bFileOutputStream\b|\bFileWriter\b|\bRandomAccessFile\b|getSharedPreferences|\bFiles\.write\b/);
    }
    const store = code(javaAt('ReminderStore.java'));
    expect(store).toMatch(/VaultCrypto\.writeSealed\(/);
    expect(store).toMatch(/VaultCrypto\.readSealed\(/);
    expect(javaAt('ReminderStore.java')).toContain('"reminders.enc"');
    // The crypto lives in one place now; ProfileVaultPlugin calls it.
    const vault = code(javaAt('ProfileVaultPlugin.java'));
    expect(vault).not.toMatch(/\bCipher\b|KeyGenerator|GCMParameterSpec/);
    expect(vault).toMatch(/VaultCrypto\./);
    const crypto = javaAt('VaultCrypto.java');
    expect(crypto).toContain('"raf.profile.v1"');
    expect(crypto).toContain('"AES/GCM/NoPadding"');
    expect(code(crypto)).toMatch(/FORMAT_VERSION\s*=\s*1\s*;/);
    expect(code(crypto)).toMatch(/TAG_BITS\s*=\s*128\s*;/);
  });

  it('wipe also clears reminders, posted notifications and shortcuts', () => {
    const wipe = code(bodyOf(javaAt('ProfileVaultPlugin.java'), 'public void wipe('));
    expect(wipe).toMatch(/ReminderScheduler\.cancelAll\(/);
    expect(wipe).toMatch(/ReminderStore\.delete\(/);
    expect(wipe).toMatch(/NotificationManagerCompat\.from\([^)]*\)\.cancelAll\(\s*\)/);
    expect(wipe).toMatch(/AppShortcutsPlugin\.clearEverything\(/);
    expect(wipe).toMatch(/ReminderStore\.exists\(/);
  });

  it('ClipboardPeekPlugin.hint never calls getPrimaryClip; readText checks hasWindowFocus first', () => {
    const raw = javaAt('ClipboardPeekPlugin.java');
    const source = code(raw);
    expect(raw).toMatch(/@CapacitorPlugin\(\s*name\s*=\s*"ClipboardPeek"\s*\)/);
    const hint = bodyOf(source, 'public void hint(');
    expect(hint).not.toMatch(/getPrimaryClip\s*\(/);
    expect(hint).toMatch(/getPrimaryClipDescription\(/);
    const read = bodyOf(source, 'public void readText(');
    const focus = read.search(/hasWindowFocus\(\s*\)/);
    expect(focus).toBeGreaterThan(-1);
    expect(focus).toBeLessThan(read.search(/getPrimaryClip\s*\(/));
    // The only getPrimaryClip in the class is the one in readText.
    expect([...source.matchAll(/getPrimaryClip\s*\(/g)]).toHaveLength(1);
    expect(source).toMatch(/MAX_TEXT\s*=\s*4096/);
    expect(source).not.toMatch(/\bBundle\b|InstanceState|saveCall|setKeepAlive|getSharedPreferences|setPrimaryClip|clearPrimaryClip/);
    constantRejects('ClipboardPeekPlugin.java', raw);
  });

  it('IncomingIntentPlugin never touches a Bundle or saved state and rejects without call data', () => {
    const raw = javaAt('IncomingIntentPlugin.java');
    const source = code(raw);
    expect(raw).toMatch(/@CapacitorPlugin\(\s*name\s*=\s*"IncomingIntent"\s*\)/);
    expect(source).not.toMatch(/\bBundle\b|putByteArray|InstanceState|startActivityForResult|setKeepAlive|saveCall|getSharedPreferences/);
    for (const m of source.matchAll(/notifyListeners\(([^;]*)\);/g)) {
      expect(m[1], 'an event without data, not retained').toMatch(/^\s*""\s*,\s*(null|new JSObject\(\))\s*,\s*false\s*$/);
    }
    expect(source).toMatch(/notifyListeners\(/);
    constantRejects('IncomingIntentPlugin.java', raw);
    const load = bodyOf(source, 'public void load(');
    expect(load.search(/incomingHandled/)).toBeGreaterThan(-1);
    expect(load.search(/incomingHandled/)).toBeLessThan(load.indexOf('accept('));
    const onNew = bodyOf(source, 'void handleOnNewIntent(');
    expect(onNew.search(/intent\s*==\s*getActivity\(\)\.getIntent\(\)/)).toBeGreaterThan(-1);
    const take = bodyOf(source, 'public void take(');
    expect(take.search(/slot\s*=\s*null/)).toBeGreaterThan(-1);
    expect(take.search(/slot\s*=\s*null/)).toBeLessThan(take.indexOf('call.resolve('));
    expect(source).toMatch(/IncomingIntents\.classify\(/);
  });

  it('IncomingFilePlugin takes only what the classifier calls a file', () => {
    const accept = code(bodyOf(javaAt('IncomingFilePlugin.java'), 'private void accept('));
    const classify = accept.search(/IncomingIntents\.classify\(/);
    expect(classify).toBeGreaterThan(-1);
    expect(accept).toMatch(/Kind\.FILE/);
    expect(classify).toBeLessThan(accept.indexOf('incomingHandled = true'));
  });

  it('the new plugins put no call data into reject messages', () => {
    for (const n of ['RemindersPlugin.java', 'AppShortcutsPlugin.java', 'BrowserRolePlugin.java']) constantRejects(n, javaAt(n));
  });

  it('DebugReminderReceiver exists only under src/debug and the main manifest does not name it', () => {
    expect(existsSync(join(debugJavaDir, 'DebugReminderReceiver.java'))).toBe(true);
    expect(existsSync(join(javaDir, 'DebugReminderReceiver.java'))).toBe(false);
    expect(existsSync(join(repo, 'mobile/android/app/src/release'))).toBe(false);
    expect(mainManifest()).not.toMatch(/DebugReminderReceiver|app\.raf\.dev\.debug\./);
    const debug = readFileSync(join(repo, 'mobile/android/app/src/debug/AndroidManifest.xml'), 'utf8');
    expect(debug).toMatch(/android:name="\.DebugReminderReceiver"/);
    expect(attr(debug, 'name').filter((n) => n.includes('.debug.')).sort()).toEqual([
      'app.raf.dev.debug.FIRE_DUE', 'app.raf.dev.debug.RESCHEDULE',
    ]);
    expect(debug).not.toMatch(/uses-permission/);
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
      expect(permissionsOf(manifest)).toEqual(PERMISSIONS);
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

  describe('resume keyboard', () => {
    const kbDir = join(javaDir, 'keyboard');
    const kbFiles = () => (existsSync(kbDir) ? walk(kbDir, /\.java$/) : []);
    const kbAt = (name: string) => readFileSync(join(kbDir, name), 'utf8');
    const resDir = join(repo, 'mobile/android/app/src/main/res');

    it('the manifest declares the keyboard in its own process, bound by the system, not direct-boot aware, with no new permission', () => {
      const manifest = mainManifest();
      const services = [...manifest.matchAll(/<service\b([^>]*)>([\s\S]*?)<\/service>/g)];
      const kb = services.filter((m) => m[1]!.includes('android:name=".keyboard.ResumeKeyboardService"'));
      expect(kb).toHaveLength(1);
      const attrs = kb[0]![1]!;
      const body = kb[0]![2]!;
      expect(attrs).toContain('android:process=":keyboard"');
      expect(attrs).toContain('android:permission="android.permission.BIND_INPUT_METHOD"');
      expect(attrs).toContain('android:exported="true"');
      expect(attrs).toContain('android:label="@string/kb_name"');
      // No component is direct-boot aware (the words may appear in a comment explaining why).
      expect(manifest.replace(/<!--[\s\S]*?-->/g, ' ')).not.toMatch(/directBootAware/);
      expect(body).toMatch(/<action android:name="android\.view\.InputMethod"\s*\/>/);
      expect(body).toMatch(/<meta-data android:name="android\.view\.im" android:resource="@xml\/method"\s*\/>/);
      expect(permissionsOf(manifest)).toEqual(PERMISSIONS);
      const method = readFileSync(join(resDir, 'xml/method.xml'), 'utf8').replace(/<!--[\s\S]*?-->/g, ' ');
      expect(method).toMatch(/<input-method\b[^>]*android:supportsSwitchingToNextInputMethod="true"/);
      expect(method).not.toMatch(/settingsActivity/);
      const subtypes = [...method.matchAll(/<subtype\b([^>]*)\/>/g)].map((m) => m[1]!);
      expect(subtypes).toHaveLength(1);
      expect(subtypes[0]).toContain('android:imeSubtypeLocale="en_US"');
      expect(subtypes[0]).toContain('android:imeSubtypeMode="keyboard"');
      expect(subtypes[0]).toContain('android:isAsciiCapable="true"');
      expect(subtypes[0]).toContain('android:label="@string/kb_subtype"');
    });

    it('nothing in keyboard/ logs, prints or dumps a stack trace', () => {
      const names = kbFiles().map((f) => relative(kbDir, f));
      expect(names).toEqual(expect.arrayContaining(['ResumeKeyboardService.java', 'KeyboardDataStore.java', 'EntryRowView.java']));
      const banned = /\bandroid\.util\.Log\b|\bLog\.[deivwa]\w*\s*\(|\bSystem\.(out|err)\b|printStackTrace/;
      expect(offenders(kbFiles(), banned)).toEqual([]);
      expect(offenders([join(javaDir, 'ResumeKeyboardPlugin.java')], banned)).toEqual([]);
    });

    it('ResumeKeyboardPlugin rejects only with constant codes', () => {
      const raw = javaAt('ResumeKeyboardPlugin.java');
      expect(raw).toMatch(/@CapacitorPlugin\(\s*name\s*=\s*"ResumeKeyboard"\s*\)/);
      const args = rejectArguments(raw);
      expect(args.length).toBeGreaterThanOrEqual(3);
      constantRejects('ResumeKeyboardPlugin.java', raw);
      const codes = args.map((a) => /"(\w+)"\s*$/.exec(a.trim())?.[1]);
      expect([...new Set(codes)].sort()).toEqual(['BAD_DATA', 'TOO_LARGE', 'WRITE_FAILED']);
    });

    it('writeData and clearData work synchronously under VaultCrypto.FILES_LOCK and write only through VaultCrypto', () => {
      const source = code(javaAt('ResumeKeyboardPlugin.java'));
      const write = bodyOf(source, 'public void writeData(');
      const size = write.search(/MAX_BYTES/);
      const parse = write.search(/KeyboardData\.parse\(/);
      const lock = write.search(/synchronized\s*\(\s*VaultCrypto\.FILES_LOCK\s*\)/);
      const seal = write.search(/VaultCrypto\.writeSealed\(\s*KeyboardDataStore\.file\(/);
      expect(size).toBeGreaterThan(-1);
      expect(parse).toBeGreaterThan(size);
      expect(lock).toBeGreaterThan(parse);
      expect(seal).toBeGreaterThan(lock);
      // No background thread: the file work is done before the call resolves, so delete-all cannot race it.
      expect(write).not.toMatch(/execute\(|submit\(|new Thread|post\(/);
      const clear = bodyOf(source, 'public void clearData(');
      expect(clear).toMatch(/synchronized\s*\(\s*VaultCrypto\.FILES_LOCK\s*\)[\s\S]*KeyboardDataStore\.delete\(/);
      expect(source).not.toMatch(/\bFileOutputStream\b|\bFileWriter\b|\bRandomAccessFile\b|getSharedPreferences|\bFiles\.write\b/);
      const store = code(kbAt('KeyboardDataStore.java'));
      expect(kbAt('KeyboardDataStore.java')).toContain('"keyboard.enc"');
      expect(store).toMatch(/MAX_BYTES\s*=\s*524288\s*;/);
      expect(bodyOf(store, 'static void delete(')).toMatch(/synchronized\s*\(\s*VaultCrypto\.FILES_LOCK\s*\)[\s\S]*VaultCrypto\.deleteSealed\(/);
      expect(store).toMatch(/VaultCrypto\.readSealedIfKeyExists\(/);
      // The keyboard only ever reads, and never through a method that could create the key.
      const used = new Set<string>();
      for (const f of kbFiles()) for (const m of code(readFileSync(f, 'utf8')).matchAll(/VaultCrypto\.(\w+)/g)) used.add(m[1]!);
      expect([...used].sort()).toEqual(['FILES_LOCK', 'deleteSealed', 'readSealedIfKeyExists', 'sealedExists']);
      for (const f of kbFiles()) {
        const c = code(readFileSync(f, 'utf8'));
        expect(c, relative(kbDir, f)).not.toMatch(/\bFileOutputStream\b|\bFileWriter\b|\bRandomAccessFile\b|\bFiles\.write\b|openFileOutput/);
      }
    });

    it('the keyboard stores one boolean in plain preferences: whether the Chinese tip was dismissed', () => {
      const prefs: string[] = [];
      for (const f of kbFiles()) {
        const raw = code(readFileSync(f, 'utf8'));
        for (const m of raw.matchAll(/getSharedPreferences\(([^)]*)\)/g)) prefs.push(m[1]!.trim());
        for (const m of raw.matchAll(/\.put(\w+)\(\s*([^,]+),/g)) {
          expect(`${m[1]} ${m[2]!.trim()}`, relative(kbDir, f)).toBe('Boolean PREF_TIP');
        }
      }
      expect(prefs.length).toBeGreaterThan(0);
      for (const p of prefs) expect(p).toMatch(/^PREFS\s*,\s*(?:Context\.)?MODE_PRIVATE$/);
      const service = kbAt('ResumeKeyboardService.java');
      expect(service).toMatch(/PREFS\s*=\s*"kb_prefs"/);
      expect(service).toMatch(/PREF_TIP\s*=\s*"tipChineseSeen"/);
    });

    it('wipe deletes keyboard.enc under FILES_LOCK before the key, and checks it is gone', () => {
      const wipe = code(bodyOf(javaAt('ProfileVaultPlugin.java'), 'public void wipe('));
      const del = wipe.search(/synchronized\s*\(\s*VaultCrypto\.FILES_LOCK\s*\)\s*\{\s*KeyboardDataStore\.delete\(\s*context\s*\)/);
      expect(del).toBeGreaterThan(-1);
      expect(del).toBeLessThan(wipe.search(/VaultCrypto\.deleteKey\(/));
      expect(wipe).toMatch(/!\s*KeyboardDataStore\.exists\(\s*context\s*\)/);
    });

    it('readSealedIfKeyExists never creates the key and reads only the base file', () => {
      const crypto = code(javaAt('VaultCrypto.java'));
      expect(crypto).toMatch(/static\s+final\s+Object\s+FILES_LOCK\s*=\s*new\s+Object\(\)\s*;/);
      const read = bodyOf(crypto, 'static byte[] readSealedIfKeyExists(');
      expect(read).not.toMatch(/\bkey\(\s*\)/);
      expect(read).toMatch(/existingKey\(\s*\)/);
      expect(read).toMatch(/new\s+FileInputStream\(/);
      expect(read).not.toMatch(/AtomicFile|readFully|\.bak/);
      const existing = bodyOf(crypto, 'private static SecretKey existingKey(');
      expect(existing).not.toMatch(/KeyGenerator|generateKey|\bkey\(\s*\)/);
    });

    it('the service never goes fullscreen, never reads the field text, and hides the resume when locked', () => {
      const service = code(kbAt('ResumeKeyboardService.java'));
      expect(bodyOf(service, 'public boolean onEvaluateFullscreenMode(')).toMatch(/return\s+false\s*;/);
      for (const f of kbFiles()) {
        expect(code(readFileSync(f, 'utf8')), relative(kbDir, f)).not.toMatch(
          /getTextBeforeCursor|getTextAfterCursor|getSelectedText|getSurroundingText|getExtractedText/,
        );
      }
      expect(service).toMatch(/sendDownUpKeyEvents\(\s*KeyEvent\.KEYCODE_DEL\s*\)/);
      expect(service).toMatch(/switchToPreviousInputMethod\(\s*\)/);
      expect(service).toMatch(/showInputMethodPicker\(\s*\)/);
      expect(service).toMatch(/isKeyguardLocked\(\s*\)/);
      expect(service).toMatch(/isUserUnlocked\(\s*\)/);
      expect(service).toMatch(/store\.forget\(\s*\)/);
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
