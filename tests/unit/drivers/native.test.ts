import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeDriver } from '../../../src/drivers/native';
import { choice, ctx1, ctx2, firstControl, mount, multi, record } from './helpers';

afterEach(() => {
  document.body.innerHTML = '';
  vi.restoreAllMocks();
});

describe('native driver: text / textarea', () => {
  it('writes through the setter and fires focus → input → change → blur; reads back .value', async () => {
    const c = firstControl('<input id="n" type="text">');
    const log = record(c.el, ['focus', 'input', 'change', 'blur']);
    const r = await nativeDriver.fill(c, { kind: 'text', text: 'Alice  Zhang' }, ctx1);
    expect(r).toMatchObject({ ok: true, observed: 'Alice  Zhang' });
    expect(log).toEqual(['focus', 'input', 'change', 'blur']);
    expect(nativeDriver.read(c)).toBe('Alice  Zhang');
  });

  it('fills a textarea', async () => {
    const c = firstControl('<textarea></textarea>');
    const r = await nativeDriver.fill(c, { kind: 'text', text: 'line1\nline2' }, ctx1);
    expect(r.ok).toBe(true);
    expect((c.el as HTMLTextAreaElement).value).toBe('line1\nline2');
  });

  it('uses per-character typing on attempt 2', async () => {
    const c = firstControl('<input type="text">');
    const keys = record(c.el, ['keydown']);
    const r = await nativeDriver.fill(c, { kind: 'text', text: 'abc' }, ctx2);
    expect(r.ok).toBe(true);
    expect(keys).toHaveLength(3);
  });

  it('fails when the page rewrites the value (read-back mismatch)', async () => {
    const c = firstControl('<input type="text">');
    c.el.addEventListener('input', () => {
      (c.el as HTMLInputElement).value = 'REWRITTEN';
    });
    const r = await nativeDriver.fill(c, { kind: 'text', text: 'abc' }, ctx1);
    expect(r).toMatchObject({ ok: false, outcome: 'action_failed', observed: 'REWRITTEN' });
  });

  it('accepts a display-carrying intent for a text control, rejects check / file', async () => {
    const c = firstControl('<input type="text">');
    expect((await nativeDriver.fill(c, choice('Master'), ctx1)).ok).toBe(true);
    expect((c.el as HTMLInputElement).value).toBe('Master');
    const bad = await nativeDriver.fill(c, { kind: 'check', checked: true }, ctx1);
    expect(bad).toMatchObject({ ok: false, outcome: 'action_failed' });
  });
});

describe('native driver: date', () => {
  it('writes YYYY-MM-DD for type=date (day defaults to 01) and YYYY-MM for type=month', async () => {
    const d = firstControl('<input type="date">');
    const r = await nativeDriver.fill(d, { kind: 'date', display: '2020-09', year: 2020, month: 9 }, ctx1);
    expect(r).toMatchObject({ ok: true, observed: '2020-09-01' });
    document.body.innerHTML = '';
    const m = firstControl('<input type="month">');
    const r2 = await nativeDriver.fill(m, { kind: 'date', display: '2020-09', year: 2020, month: 9, day: 15 }, ctx1);
    expect(r2).toMatchObject({ ok: true, observed: '2020-09' });
  });

  it('writes an explicit day', async () => {
    const d = firstControl('<input type="date">');
    await nativeDriver.fill(d, { kind: 'date', display: 'x', year: 1999, month: 1, day: 31 }, ctx1);
    expect((d.el as HTMLInputElement).value).toBe('1999-01-31');
  });

  it('refuses an intent it cannot express', async () => {
    const d = firstControl('<input type="date">');
    const r = await nativeDriver.fill(d, { kind: 'text', text: 'last year' }, ctx1);
    expect(r).toMatchObject({ ok: false, outcome: 'action_failed' });
  });
});

describe('native driver: select', () => {
  const SELECT = `<select id="deg"><option value="">Please select</option>
    <option value="b">Bachelor</option><option value="m">Master</option><option value="d">Doctor</option></select>`;

  it('selects the matched option, fires input + change, reads back its text', async () => {
    const c = firstControl(SELECT);
    const log = record(c.el, ['input', 'change']);
    const r = await nativeDriver.fill(c, choice('Master'), ctx1);
    expect(r).toMatchObject({ ok: true, observed: 'Master' });
    expect((c.el as HTMLSelectElement).value).toBe('m');
    expect(log).toEqual(['input', 'change']);
  });

  it('never selects on none → no_option', async () => {
    const c = firstControl(SELECT);
    const r = await nativeDriver.fill(c, choice('Diploma'), ctx1);
    expect(r).toMatchObject({ ok: false, outcome: 'no_option' });
    expect((c.el as HTMLSelectElement).selectedIndex).toBe(0);
  });

  it('never selects on ambiguous → needs_review with candidate labels', async () => {
    const c = firstControl(
      '<select><option value="">-</option><option value="1">Computer Science</option><option value="2">Computer Science</option></select>',
    );
    const r = await nativeDriver.fill(c, choice('Computer Science'), ctx1);
    expect(r).toMatchObject({ ok: false, outcome: 'needs_review', candidates: ['Computer Science'] });
    expect((c.el as HTMLSelectElement).selectedIndex).toBe(0);
  });

  it('refuses a matcher that returns a disabled option or the placeholder', async () => {
    const c = firstControl(
      '<select><option value="">Please select</option><option value="x" disabled>Locked</option><option value="y">Open</option></select>',
    );
    const sloppy = (index: number) => ({
      kind: 'choice' as const,
      display: 'x',
      query: 'x',
      match: () => ({ status: 'matched' as const, index, confidence: 1 }),
    });
    expect((await nativeDriver.fill(c, sloppy(1), ctx1)).outcome).toBe('no_option');
    expect((await nativeDriver.fill(c, sloppy(0), ctx1)).outcome).toBe('no_option');
    expect((c.el as HTMLSelectElement).selectedIndex).toBe(0);
  });

  it('selects the right option among duplicate values', async () => {
    const c = firstControl('<select><option value="1">One</option><option value="1">Uno</option></select>');
    await nativeDriver.fill(c, choice('Uno'), ctx1);
    expect((c.el as HTMLSelectElement).selectedIndex).toBe(1);
  });

  it('reads null for a placeholder selection', () => {
    const c = firstControl(SELECT);
    expect(nativeDriver.read(c)).toBeNull();
  });

  it('multi-select: selects exactly the matched set; all-or-nothing on a miss', async () => {
    const c = firstControl(
      '<select multiple><option value="a">Alpha</option><option value="b">Beta</option><option value="c">Gamma</option></select>',
    );
    const sel = c.el as HTMLSelectElement;
    sel.options[2]!.selected = true; // pre-existing selection is replaced
    const r = await nativeDriver.fill(c, multi('Alpha', 'Beta'), ctx1);
    expect(r).toMatchObject({ ok: true, observed: 'Alpha, Beta' });
    expect(Array.from(sel.selectedOptions).map((o) => o.value)).toEqual(['a', 'b']);

    const miss = await nativeDriver.fill(c, multi('Alpha', 'Nope'), ctx1);
    expect(miss.outcome).toBe('no_option');
    expect(Array.from(sel.selectedOptions).map((o) => o.value)).toEqual(['a', 'b']);
  });

  it('rejects several values for a single select', async () => {
    const c = firstControl(SELECT);
    const r = await nativeDriver.fill(c, multi('Master', 'Doctor'), ctx1);
    expect(r).toMatchObject({ ok: false, outcome: 'action_failed' });
  });
});

describe('native driver: radio', () => {
  const RADIO = `<div id="g"><label><input type="radio" name="g" value="m"> Male</label>
    <label><input type="radio" name="g" value="f"> Female</label>
    <label><input type="radio" name="g" value="o"> Other</label></div>`;

  it('clicks the matched radio and reads back the checked label', async () => {
    const c = firstControl(RADIO);
    const female = document.querySelector<HTMLInputElement>('input[value=f]')!;
    const log = record(female, ['click', 'input', 'change']);
    const r = await nativeDriver.fill(c, choice('Female'), ctx1);
    expect(r).toMatchObject({ ok: true, observed: 'Female' });
    expect(female.checked).toBe(true);
    expect(log).toContain('click');
    expect(log).toContain('change');
  });

  it('switches an already selected radio', async () => {
    const c = firstControl(RADIO);
    document.querySelector<HTMLInputElement>('input[value=m]')!.checked = true;
    await nativeDriver.fill(c, choice('Other'), ctx1);
    expect(nativeDriver.read(c)).toBe('Other');
  });

  it('no_option / needs_review leave the group untouched', async () => {
    const c = firstControl(RADIO);
    expect((await nativeDriver.fill(c, choice('Unknown'), ctx1)).outcome).toBe('no_option');
    expect(nativeDriver.read(c)).toBeNull();
    document.body.innerHTML = '';
    const dup = firstControl(
      '<div><input type="radio" name="d" id="d1"><label for="d1">Yes</label><input type="radio" name="d" id="d2"><label for="d2">Yes</label></div>',
    );
    const r = await nativeDriver.fill(dup, choice('Yes'), ctx1);
    expect(r).toMatchObject({ outcome: 'needs_review', candidates: ['Yes'] });
  });

  it('clicks the input first on attempt 1 and the label first on attempt 2', async () => {
    const html = '<div><input type="radio" name="r" id="r1"><label for="r1">Yes</label><input type="radio" name="r" id="r2"><label for="r2">No</label></div>';
    const c1 = firstControl(html);
    const first: string[] = [];
    document.addEventListener('click', (e) => first.push((e.target as Element).tagName), true);
    await nativeDriver.fill(c1, choice('Yes'), ctx1);
    expect(first[0]).toBe('INPUT');
    document.body.innerHTML = '';
    first.length = 0;
    const c2 = firstControl(html);
    await nativeDriver.fill(c2, choice('Yes'), ctx2);
    expect(first[0]).toBe('LABEL');
    expect(nativeDriver.read(c2)).toBe('Yes');
  });
});
describe('native driver: checkbox', () => {
  it('single checkbox: clicks only when the state differs; reads back true / false', async () => {
    const c = firstControl('<label><input type="checkbox"> I agree</label>');
    const cb = c.el as HTMLInputElement;
    const clicks = record(cb, ['click']);
    expect(await nativeDriver.fill(c, { kind: 'check', checked: true }, ctx1)).toMatchObject({ ok: true, observed: 'true' });
    expect(cb.checked).toBe(true);
    expect(clicks).toHaveLength(1);
    // Already checked: no further click.
    expect((await nativeDriver.fill(c, { kind: 'check', checked: true }, ctx1)).ok).toBe(true);
    expect(clicks).toHaveLength(1);
    expect(await nativeDriver.fill(c, { kind: 'check', checked: false }, ctx1)).toMatchObject({ ok: true, observed: 'false' });
    expect(nativeDriver.read(c)).toBe('false');
  });

  it('reports failure when the page vetoes the click', async () => {
    const c = firstControl('<input type="checkbox">');
    c.el.addEventListener('click', (e) => e.preventDefault());
    const r = await nativeDriver.fill(c, { kind: 'check', checked: true }, ctx1);
    expect(r).toMatchObject({ ok: false, outcome: 'action_failed', observed: 'false' });
  });

  const GROUP = `<div><label><input type="checkbox" name="s" value="js"> JavaScript</label>
    <label><input type="checkbox" name="s" value="py"> Python</label>
    <label><input type="checkbox" name="s" value="go"> Go</label></div>`;

  it('checkbox group: multi intent sets exactly the matched boxes', async () => {
    const c = firstControl(GROUP);
    document.querySelector<HTMLInputElement>('input[value=go]')!.checked = true;
    const r = await nativeDriver.fill(c, multi('JavaScript', 'Python'), ctx1);
    expect(r).toMatchObject({ ok: true, observed: 'JavaScript, Python' });
    expect(document.querySelector<HTMLInputElement>('input[value=go]')!.checked).toBe(false);
  });

  it('checkbox group: a miss changes nothing', async () => {
    const c = firstControl(GROUP);
    const r = await nativeDriver.fill(c, multi('JavaScript', 'Rust'), ctx1);
    expect(r.outcome).toBe('no_option');
    expect(nativeDriver.read(c)).toBeNull();
  });

  it('check intent on a multi-box group is rejected', async () => {
    const c = firstControl(GROUP);
    expect((await nativeDriver.fill(c, { kind: 'check', checked: true }, ctx1)).outcome).toBe('action_failed');
  });
});

describe('native driver: file', () => {
  const PDF = { name: 'cv.pdf', type: 'application/pdf', dataUrl: 'data:application/pdf;base64,SGVsbG8h' };

  it('attaches a file built from the data URL (decoded manually) and fires input + change', async () => {
    const c = firstControl('<input type="file">');
    const log = record(c.el, ['input', 'change']);
    const r = await nativeDriver.fill(c, { kind: 'file', file: PDF }, ctx1);
    expect(r).toMatchObject({ ok: true, observed: 'cv.pdf' });
    const file = (c.el as HTMLInputElement).files![0]!;
    expect(file.name).toBe('cv.pdf');
    expect(file.type).toBe('application/pdf');
    expect(file.size).toBe(6);
    expect(await file.text()).toBe('Hello!');
    expect(log).toEqual(['input', 'change']);
  });

  it('falls back to a FileList-shaped object when DataTransfer exists but the assignment is rejected', async () => {
    const added: File[] = [];
    class FakeDT {
      items = { add: (f: File) => void added.push(f) };
      get files() {
        return Object.assign([...added], { item: (i: number) => added[i] ?? null });
      }
    }
    vi.stubGlobal('DataTransfer', FakeDT);
    const c = firstControl('<input type="file">');
    // jsdom rejects a non-FileList assignment, so the driver must fall back instead of failing.
    const r = await nativeDriver.fill(c, { kind: 'file', file: PDF }, ctx1);
    expect(added).toHaveLength(1);
    expect(r.ok).toBe(true);
    vi.unstubAllGlobals();
  });

  it('fails cleanly on a broken data URL', async () => {
    const c = firstControl('<input type="file">');
    const r = await nativeDriver.fill(c, { kind: 'file', file: { ...PDF, dataUrl: 'not-a-data-url' } }, ctx1);
    expect(r).toMatchObject({ ok: false, outcome: 'action_failed' });
    expect(nativeDriver.read(c)).toBeNull();
  });
});

describe('native driver: richtext', () => {
  const EDITOR = '<div id="ed" contenteditable="true">old text</div>';

  it('uses the editor paste handler when it takes over the paste', async () => {
    const c = firstControl(EDITOR);
    c.el.addEventListener('paste', (e) => {
      e.preventDefault();
      const dt = (e as ClipboardEvent).clipboardData!;
      c.el.textContent = dt.getData('text/plain');
    });
    const exec = vi.fn();
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    const r = await nativeDriver.fill(c, { kind: 'text', text: 'Hello world' }, ctx1);
    expect(r).toMatchObject({ ok: true, observed: 'Hello world' });
    expect(exec).not.toHaveBeenCalled();
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  it('falls back to execCommand(insertText) when paste is ignored', async () => {
    const c = firstControl(EDITOR);
    const exec = vi.fn((cmd: string, _ui: boolean, text: string) => {
      c.el.textContent = text;
      return cmd === 'insertText';
    });
    (document as unknown as { execCommand: unknown }).execCommand = exec;
    const r = await nativeDriver.fill(c, { kind: 'text', text: 'From exec' }, ctx1);
    expect(r.ok).toBe(true);
    expect(exec).toHaveBeenCalledWith('insertText', false, 'From exec');
    delete (document as unknown as { execCommand?: unknown }).execCommand;
  });

  it('falls back to textContent + input event when neither works (jsdom has no execCommand)', async () => {
    const c = firstControl(EDITOR);
    const log = record(c.el, ['input', 'change', 'blur']);
    const r = await nativeDriver.fill(c, { kind: 'text', text: 'Plain fallback' }, ctx1);
    expect(r).toMatchObject({ ok: true, observed: 'Plain fallback' });
    expect(log).toContain('input');
    expect(log).toContain('change');
  });

  it('tolerates editors that drop whitespace between paragraphs', async () => {
    const c = firstControl(EDITOR);
    c.el.addEventListener('paste', (e) => {
      e.preventDefault();
      c.el.innerHTML = '<p>line one</p><p>line two</p>';
    });
    const r = await nativeDriver.fill(c, { kind: 'text', text: 'line one\nline two' }, ctx1);
    expect(r.ok).toBe(true);
  });
});
