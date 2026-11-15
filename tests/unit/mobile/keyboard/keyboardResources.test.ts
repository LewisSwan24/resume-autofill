// @vitest-environment node
// The keyboard takes its colours, font and icons only from the generated resources: every
// R.color / R.font / R.drawable / R.dimen / R.string / R.id it names exists, and no keyboard source writes a colour
// of its own.
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const repo = fileURLToPath(new URL('../../../..', import.meta.url));
const main = join(repo, 'mobile/android/app/src/main');
const res = join(main, 'res');
const kbDir = join(main, 'java/app/raf/dev/keyboard');

const kbSources = () =>
  existsSync(kbDir) ? readdirSync(kbDir).filter((n) => n.endsWith('.java')).map((n) => ({ n, text: readFileSync(join(kbDir, n), 'utf8') })) : [];
const xmlSources = () =>
  ['layout/kb_root.xml', 'xml/method.xml'].map((p) => ({ n: p, text: readFileSync(join(res, p), 'utf8') }));

/** Names declared in res/values*\/*.xml for one resource type (color, dimen, string, id). */
function declared(type: string): Set<string> {
  const out = new Set<string>();
  for (const dir of readdirSync(res).filter((d) => d.startsWith('values'))) {
    for (const f of readdirSync(join(res, dir)).filter((x) => x.endsWith('.xml'))) {
      const text = readFileSync(join(res, dir, f), 'utf8');
      for (const m of text.matchAll(new RegExp(`<${type}\\s+name="(\\w+)"`, 'g'))) out.add(m[1]!);
      for (const m of text.matchAll(new RegExp(`<item\\s+type="${type}"\\s+name="(\\w+)"`, 'g'))) out.add(m[1]!);
      for (const m of text.matchAll(new RegExp(`<item\\s+name="(\\w+)"\\s+type="${type}"`, 'g'))) out.add(m[1]!);
    }
  }
  // Ids are also declared by layouts with @+id.
  if (type === 'id' && existsSync(join(res, 'layout'))) {
    for (const f of readdirSync(join(res, 'layout'))) {
      for (const m of readFileSync(join(res, 'layout', f), 'utf8').matchAll(/@\+id\/(\w+)/g)) out.add(m[1]!);
    }
  }
  return out;
}

/** File resources (drawable, font, layout, xml) by base name, across qualifiers. */
function files(type: string): Set<string> {
  const out = new Set<string>();
  for (const dir of readdirSync(res).filter((d) => d === type || d.startsWith(`${type}-`))) {
    for (const f of readdirSync(join(res, dir))) out.add(f.replace(/\..*$/, ''));
  }
  return out;
}

const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:\\"])\/\/.*$/gm, '$1').replace(/<!--[\s\S]*?-->/g, ' ');

describe('keyboard resources', () => {
  it('every resource the keyboard names exists', () => {
    const sources = [...kbSources(), ...xmlSources()];
    expect(sources.map((s) => s.n)).toEqual(expect.arrayContaining(['KbTheme.java', 'ResumeKeyboardService.java']));
    const missing: string[] = [];
    const seen = new Set<string>();
    const exists: Record<string, () => Set<string>> = {
      color: () => declared('color'), dimen: () => declared('dimen'), string: () => declared('string'), id: () => declared('id'),
      drawable: () => files('drawable'), font: () => files('font'), layout: () => files('layout'), xml: () => files('xml'),
    };
    for (const { n, text } of sources) {
      const body = stripComments(text);
      const refs: [string, string][] = [
        ...[...body.matchAll(/\bR\.(color|dimen|string|id|drawable|font|layout|xml)\.(\w+)/g)].map((m): [string, string] => [m[1]!, m[2]!]),
        ...[...body.matchAll(/@(color|dimen|string|id|drawable|font|layout|xml)\/(\w+)/g)].map((m): [string, string] => [m[1]!, m[2]!]),
        ...[...body.matchAll(/@\+id\/(\w+)/g)].map((m): [string, string] => ['new-id', m[1]!]),
      ];
      for (const [type, name] of refs) {
        seen.add(`${type}/${name}`);
        if (type === 'new-id') continue;
        if (!exists[type]!().has(name)) missing.push(`${n}: ${type}/${name}`);
      }
    }
    expect(missing).toEqual([]);
    // The views really use the generated theme.
    for (const r of ['color/raf_color_bg', 'color/raf_color_surface', 'color/raf_color_text', 'color/raf_color_border',
      'color/raf_color_primary', 'color/raf_color_primary_text', 'color/raf_color_selected', 'color/raf_color_on_selected',
      'color/raf_color_focus', 'font/raf_lexend', 'drawable/kb_ic_backspace', 'drawable/kb_ic_arrow_left_right', 'id/kb_action_read_value']) {
      expect(seen.has(r), r).toBe(true);
    }
  });

  it('the keyboard uses only generated colours, the Lexend family and kb_ic_* icons', () => {
    for (const { n, text } of [...kbSources(), ...xmlSources()]) {
      const body = stripComments(text);
      for (const m of body.matchAll(/\b(?:R\.color\.|@color\/)(\w+)/g)) expect(m[1], n).toMatch(/^raf_color_\w+$/);
      for (const m of body.matchAll(/\b(?:R\.font\.|@font\/)(\w+)/g)) expect(m[1], n).toBe('raf_lexend');
      for (const m of body.matchAll(/\b(?:R\.drawable\.|@drawable\/)(\w+)/g)) expect(m[1], n).toMatch(/^kb_ic_\w+$/);
    }
  });

  it('no keyboard source writes a colour literal or a shadow', () => {
    for (const { n, text } of [...kbSources(), ...xmlSources()]) {
      const body = stripComments(text);
      expect(body, n).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(body, n).not.toMatch(/Color\.(rgb|argb|parseColor|valueOf)\s*\(|Color\.(BLACK|WHITE|RED|GRAY|DKGRAY|LTGRAY|BLUE|GREEN|YELLOW)\b/);
      // An opaque ARGB int such as 0xFF112233.
      expect(body, n).not.toMatch(/\b0x[fF]{2}[0-9a-fA-F]{6}\b/);
      expect(body, n).not.toMatch(/setShadowLayer\(|setElevation\(\s*[1-9]|android:elevation="[1-9]/);
    }
  });

  it('dimensions follow 4.4 in portrait and landscape', () => {
    const dims = (dir: string) => {
      const out = new Map<string, string>();
      for (const m of readFileSync(join(res, dir, 'kb_dimens.xml'), 'utf8').matchAll(/<dimen\s+name="(\w+)">([^<]+)<\/dimen>/g)) out.set(m[1]!, m[2]!.trim());
      return out;
    };
    const port = dims('values');
    const land = dims('values-land');
    expect(Object.fromEntries(port)).toMatchObject({
      kb_panel_height: '304dp', kb_bar_height: '48dp', kb_strip_height: '48dp', kb_key_min_height: '52dp', kb_key_gap: '4dp',
      kb_row_min_height: '48dp', kb_radius: '8dp', kb_line: '1dp', kb_side_padding: '4dp',
    });
    expect(Object.fromEntries(land)).toMatchObject({
      kb_panel_height: '240dp', kb_bar_height: '48dp', kb_key_min_height: '48dp', kb_key_gap: '2dp', kb_row_min_height: '48dp',
    });
    expect(readFileSync(join(res, 'values/ids.xml'), 'utf8')).toMatch(/<item\s+(?:type="id"\s+name="kb_action_read_value"|name="kb_action_read_value"\s+type="id")\s*\/>/);
  });
});
