// Sections a page fills one entry at a time: Add opens an editor, save closes it into a list of saved
// entries. The fields exist only while the editor is open, so these run after the rest of the page.
// Saving only moves an entry into that list; the application itself is never sent from here.
import type { EntryEditor } from '../adapters/types';
import type { FileData } from '../drivers/types';
import { waitFor } from '../drivers/wait';
import { planFill } from '../engine/plan';
import { scanDocument } from '../engine/scan';
import type { Control, FieldContext, FieldReport } from '../engine/types';
import { entryFieldText, sectionEntries } from '../engine/values';
import type { Resume } from '../schema';
import { clickAdd, type SectionGrowth } from './ensureCards';
import { runStep } from './runStep';

const WAIT_MS = 2000;
const EDITOR_FIELD = 'input, textarea, select';

const normal = (s: string) => s.normalize('NFKC').replace(/\s+/g, ' ').trim().toLowerCase();

interface Section {
  editor: EntryEditor;
  module: string;
  locale: Resume['locale'];
}

const textOf = ({ module, locale }: Section, entry: unknown, field: string) => entryFieldText(module, field, entry, locale);

const fieldOf = (key: string) => key.slice(key.indexOf('.') + 1);

const hasData = (s: Section, entry: unknown) => s.editor.fields.some((key) => textOf(s, entry, fieldOf(key)) !== '');

const hasName = (s: Section, entry: unknown) => Object.keys(s.editor.identity).some((field) => textOf(s, entry, field) !== '');

/** Each saved entry answers for one resume entry, so two degrees from one school are two entries. */
function alreadySaved(root: Element, s: Section, entries: unknown[]): Set<number> {
  const saved = Array.from(root.querySelectorAll(s.editor.saved));
  const found = new Set<number>();
  const same = (card: Element, entry: unknown) =>
    Object.entries(s.editor.identity).every(
      ([field, cell]) => normal(card.querySelector(cell)?.textContent ?? '') === normal(textOf(s, entry, field)),
    );
  entries.forEach((entry, i) => {
    if (!hasName(s, entry)) return;
    const at = saved.findIndex((card) => same(card, entry));
    if (at < 0) return;
    saved.splice(at, 1);
    found.add(i);
  });
  return found;
}

const isSubmit = (el: Element) => /^(?:submit|image)$/i.test(el.getAttribute('type') ?? '');
const clickable = (el: Element | null): el is HTMLElement =>
  el instanceof HTMLElement && !isSubmit(el) && !(el as HTMLButtonElement).disabled;

export interface EditorsRun {
  results: FieldReport[];
  growth: SectionGrowth[];
  controls: Map<string, Control>;
}

interface RunOptions {
  resume: Resume;
  files: Record<string, FileData>;
  idFor: (el: HTMLElement) => string;
}

/** Answers the user has to give, on a control that saving would take off the page. */
const WANTS_THE_USER = new Set<FieldReport['outcome']>(['needs_review', 'no_option', 'action_failed', 'no_control']);

/**
 * Fill one open editor from one entry. `empty`: nothing to put in it. `held`: something did not go in, or
 * waits for the user, so it must stay open: saving would take those fields away from the user.
 */
async function fillOpenEditor(
  doc: Document,
  box: Element,
  resume: Resume,
  { files, idFor }: RunOptions,
  run: EditorsRun,
): Promise<'empty' | 'ready' | 'held'> {
  const scan = scanDocument(doc, idFor);
  const contexts: FieldContext[] = [];
  const classifications: typeof scan.classifications = [];
  scan.contexts.forEach((ctx, i) => {
    if (!box.contains(ctx.control.el)) return;
    // There is one entry in `resume` and one card open, wherever the page counts it among the saved ones.
    contexts.push(ctx.group ? { ...ctx, group: { ...ctx.group, index: 0 } } : ctx);
    classifications.push(scan.classifications[i]!);
    run.controls.set(ctx.control.id, ctx.control);
  });
  const plan = planFill(contexts, classifications, resume, files);
  const rows = [...plan.reports];
  for (const step of plan.steps) rows.push(await runStep(step, run.controls, doc));
  run.results.push(...rows);
  if (plan.steps.length === 0) return 'empty';
  return rows.some((r) => WANTS_THE_USER.has(r.outcome)) ? 'held' : 'ready';
}

async function fillSection(doc: Document, editor: EntryEditor, opts: RunOptions, run: EditorsRun): Promise<void> {
  const root = doc.querySelector(editor.root);
  if (!root) return;
  const module = editor.section === 'internship' ? 'work' : editor.section;
  const section: Section = { editor, module, locale: opts.resume.locale };
  const rows = sectionEntries(opts.resume, module as Parameters<typeof sectionEntries>[1], editor.section);
  const entries = rows.map((r) => r.entry).filter((entry) => hasData(section, entry));
  if (entries.length === 0) return;

  const saved = alreadySaved(root, section, entries);
  const growth: SectionGrowth = { section: editor.section, have: saved.size, need: entries.length, added: 0, status: 'ok', label: editor.title };
  run.growth.push(growth);

  // A page that puts each new entry on top shows them in resume order if the last goes in first.
  const order = entries.map((_, i) => i);
  if (editor.addsOnTop) order.reverse();

  const stop = () => {
    growth.status = 'action_failed';
  };
  for (const i of order) {
    // With no name it could not be told from a saved one next time, so it would be added on every run.
    if (saved.has(i) || !hasName(section, entries[i])) continue;
    // An editor that is already open holds someone's own typing, and the page offers no second one.
    const add = root.querySelector(editor.add);
    if (root.querySelector(editor.editor) || !clickable(add)) return stop();
    clickAdd(add);
    const open = () => root.querySelector(editor.editor);
    const opened = await waitFor(() => open()?.querySelector(EDITOR_FIELD) != null, { timeout: WAIT_MS, root: doc });
    const box = open();
    if (!opened || !box) return stop();

    const state = await fillOpenEditor(doc, box, { ...opts.resume, [module]: [entries[i]] }, opts, run);
    if (state === 'held') return stop();

    const button = box.querySelector(state === 'ready' ? editor.save : editor.cancel);
    growth.label = button?.textContent?.trim() || editor.title;
    if (!clickable(button)) return stop();
    clickAdd(button);
    const closed = await waitFor(() => open() === null, { timeout: WAIT_MS, root: doc });
    // Not closed: the page refused it, most often over a required field. It stays open for the user to finish.
    if (!closed) return stop();
    if (state === 'ready') {
      growth.added += 1;
      growth.have += 1;
    }
  }
  if (growth.have < growth.need) stop();
}

export async function fillEntryEditors(doc: Document, editors: readonly EntryEditor[], opts: RunOptions): Promise<EditorsRun> {
  const run: EditorsRun = { results: [], growth: [], controls: new Map() };
  for (const editor of editors) await fillSection(doc, editor, opts, run);
  return run;
}
