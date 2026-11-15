// @vitest-environment node
// The keyboard's own chrome words are Android string resources (kb_* in res/values/strings.xml for zh and
// res/values-en/strings.xml for en), because it must speak with no data. They mirror m.kb.native.* in
// mobile/app/src/i18n.ts, which stays the one dictionary.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { mobileMessages } from '../../../../mobile/app/src/i18n';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const res = join(repo, 'mobile/android/app/src/main/res');

/** name → value of every <string>, with Android's escapes undone. */
function strings(path: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of readFileSync(join(res, path), 'utf8').matchAll(/<string\s+name="([^"]+)"[^>]*>([\s\S]*?)<\/string>/g)) {
    out.set(m[1]!, m[2]!.replace(/\\'/g, "'").replace(/\\"/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&'));
  }
  return out;
}

/** i18n placeholders become Android's positional one. */
const toAndroid = (text: string) => text.replace(/\{(label|title)\}/g, '%1$s');

const NAMES = [
  'name', 'subtype', 'resume', 'typing', 'switch_ime', 'hide', 'shift', 'shift_on', 'caps_lock', 'delete', 'space',
  'space_caption', 'comma', 'period', 'hyphen', 'symbols', 'more_symbols', 'letters', 'enter', 'action_go',
  'action_search', 'action_send', 'action_next', 'action_done', 'action_previous', 'switch_resume', 'lang_to_en',
  'lang_to_zh', 'lang_none', 'pick_resume', 'close', 'suggested', 'selected', 'inserted', 'read_value', 'empty_title',
  'empty_text', 'open_app', 'loading', 'error', 'locked', 'password', 'secret', 'no_learning', 'reveal', 'no_chinese',
  'tip_dismiss',
];

describe('keyboard native strings', () => {
  for (const [lang, file] of [['zh', 'values/strings.xml'], ['en', 'values-en/strings.xml']] as const) {
    it(`${file}: every m.kb.native.* has a kb_* string with the same words, and no kb_* string lacks a key`, () => {
      const messages = mobileMessages(lang) as unknown as Record<string, string>;
      const keys = Object.keys(messages).filter((k) => k.startsWith('m.kb.native.'));
      expect(keys.map((k) => k.slice('m.kb.native.'.length)).sort()).toEqual([...NAMES].sort());
      const xml = strings(file);
      for (const k of keys) {
        const name = `kb_${k.slice('m.kb.native.'.length)}`;
        expect(xml.get(name), `${file} ${name}`).toBe(toAndroid(messages[k]!));
      }
      const kbNames = [...xml.keys()].filter((n) => n.startsWith('kb_'));
      expect(kbNames.sort()).toEqual(NAMES.map((n) => `kb_${n}`).sort());
    });
  }

  it('only the two placeholder strings carry %1$s, and apostrophes are escaped in the XML', () => {
    for (const file of ['values/strings.xml', 'values-en/strings.xml']) {
      const raw = readFileSync(join(res, file), 'utf8');
      const withArg = [...strings(file)].filter(([n, v]) => n.startsWith('kb_') && v.includes('%1$s')).map(([n]) => n);
      expect(withArg.sort(), file).toEqual(['kb_inserted', 'kb_switch_resume']);
      for (const m of raw.matchAll(/<string\s+name="(kb_\w+)"[^>]*>([\s\S]*?)<\/string>/g)) {
        expect(m[2], `${file} ${m[1]}`).not.toMatch(/(^|[^\\])'/);
      }
    }
  });
});
