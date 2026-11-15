// @vitest-environment node
// The launcher shows the static shortcuts from res/xml/shortcuts.xml with Android string resources; their words must
// be the same as the app's own (m.sc.* in mobile/app/src/i18n.ts), in Chinese (values) and English (values-en).
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mobileMessages } from '../../../../mobile/app/src/i18n';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const res = join(repo, 'mobile/android/app/src/main/res');
const read = (path: string) => readFileSync(join(res, path), 'utf8');

/** name → value of every <string> in a resource file, with Android's escapes undone. */
function strings(path: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of read(path).matchAll(/<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) {
    out.set(m[1]!, m[2]!.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/&amp;/g, '&'));
  }
  return out;
}

function shortcuts(): { id: string; attrs: string; intent: string }[] {
  return [...read('xml/shortcuts.xml').matchAll(/<shortcut\b([^>]*)>([\s\S]*?)<\/shortcut>/g)].map((m) => ({
    id: /android:shortcutId="([^"]+)"/.exec(m[1]!)?.[1] ?? '',
    attrs: m[1]!,
    intent: m[2]!,
  }));
}

describe('launcher shortcut strings', () => {
  it('shortcuts.xml lists exactly paste and demo, with their actions, targeting the ShortcutActivity trampoline', () => {
    const list = shortcuts();
    expect(list.map((s) => s.id)).toEqual(['paste', 'demo']);
    const actions = { paste: 'app.raf.dev.action.PASTE_LINK', demo: 'app.raf.dev.action.OPEN_DEMO' } as const;
    for (const s of list) {
      const intents = [...s.intent.matchAll(/<intent\b([^>]*)\/?>/g)].map((m) => m[1]!);
      expect(intents, s.id).toHaveLength(1);
      expect(intents[0]).toContain(`android:action="${actions[s.id as keyof typeof actions]}"`);
      expect(intents[0]).toContain('android:targetPackage="app.raf.dev"');
      // Not MainActivity itself: the launcher adds CLEAR_TASK, which would recreate it (see privacyGuards).
      expect(intents[0]).toContain('android:targetClass="app.raf.dev.ShortcutActivity"');
      // A static shortcut carries no data and no extras: nothing of the person's goes to the launcher.
      expect(s.intent).not.toMatch(/android:data=|<extra\b/);
      expect(s.attrs).toMatch(/android:icon="@drawable\/ic_shortcut_(paste|demo)"/);
    }
    expect(existsSync(join(res, 'drawable/ic_shortcut_paste.xml'))).toBe(true);
    expect(existsSync(join(res, 'drawable/ic_shortcut_demo.xml'))).toBe(true);
  });

  it('zh and en shortcut labels equal m.sc.paste and m.sc.demo', () => {
    const zh = strings('values/strings.xml');
    const en = strings('values-en/strings.xml');
    const zhApp = mobileMessages('zh');
    const enApp = mobileMessages('en');
    expect(zh.get('shortcut_paste_short')).toBe(zhApp['m.sc.paste']);
    expect(zh.get('shortcut_demo_short')).toBe(zhApp['m.sc.demo']);
    expect(en.get('shortcut_paste_short')).toBe(enApp['m.sc.paste']);
    expect(en.get('shortcut_demo_short')).toBe(enApp['m.sc.demo']);
    expect(zh.get('shortcut_deleted')).toBe(zhApp['m.sc.deleted']);
    expect(en.get('shortcut_deleted')).toBe(enApp['m.sc.deleted']);
    // The launcher shows at most about 10 characters of a short label and 25 of a long one.
    for (const map of [zh, en]) {
      for (const name of ['shortcut_paste_short', 'shortcut_demo_short']) expect([...map.get(name)!].length).toBeLessThanOrEqual(25);
      for (const name of ['shortcut_paste_long', 'shortcut_demo_long']) expect([...map.get(name)!].length).toBeLessThanOrEqual(25);
    }
  });

  it('every string used by shortcuts.xml exists in both values and values-en', () => {
    const used = [...read('xml/shortcuts.xml').matchAll(/@string\/(\w+)/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThanOrEqual(4);
    const zh = strings('values/strings.xml');
    const en = strings('values-en/strings.xml');
    for (const name of [...used, 'shortcut_deleted', 'notification_channel']) {
      expect(zh.get(name), `values/${name}`).toBeTruthy();
      expect(en.get(name), `values-en/${name}`).toBeTruthy();
    }
  });
});
