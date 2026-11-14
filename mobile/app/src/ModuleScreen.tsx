// One module of the current resume: a single card of fields, or a list of entry cards (one open at a time).
import { useEffect, useRef, useState } from 'react';
import {
  addEntry,
  insertEntry,
  moveEntry,
  removeEntry,
  type ArrayModuleName,
  type ModuleMeta,
} from '../../../src/editor';
import type { Resume } from '../../../src/schema';
import { FieldEditor, findFieldTarget, revealField, type ResumeEdit } from './fields';
import { Icon } from './Icon';
import { useMT } from './i18n';
import type { FocusTarget } from './navigation';
import { IconButton, Sheet, SheetAction, type ToastMessage } from './ui';

interface Props {
  meta: ModuleMeta;
  resume: Resume;
  issues: ReadonlyMap<string, string>;
  edit: ResumeEdit;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  /** A jump from Home: open the entry, put the cursor in the field, then call onFocusDone. */
  focus?: FocusTarget | null;
  onFocusDone?: () => void;
}

/** First filled text field of an entry, shown on its folded card and in the module list. */
export function entrySummary(meta: ModuleMeta, entry: Record<string, unknown>): string {
  for (const field of meta.fields) {
    const v = entry[field.key];
    if (field.input === 'text' && typeof v === 'string' && v.trim()) return v.trim();
  }
  return '';
}

function Fields({ meta, base, resume, issues, edit }: Omit<Props, 'showToast' | 'focus' | 'onFocusDone'> & { base: string }) {
  return (
    <div className="m-fields">
      {meta.fields.map((field) => (
        <FieldEditor key={field.key} meta={meta} field={field} base={base} resume={resume} issues={issues} edit={edit} />
      ))}
    </div>
  );
}

export function ModuleBody({ meta, resume, issues, edit, showToast, focus, onFocusDone }: Props) {
  const t = useMT();
  const module = meta.module as ArrayModuleName;
  const entries = meta.repeatable ? (resume[module] as unknown as Record<string, unknown>[]) : [];
  const [openIndex, setOpenIndex] = useState<number | null>(entries.length === 1 ? 0 : null);
  const [menuIndex, setMenuIndex] = useState<number | null>(null);
  const rootRef = useRef<HTMLElement | null>(null);
  const setRoot = (el: HTMLElement | null) => {
    rootRef.current = el;
  };
  const addRef = useRef<HTMLButtonElement>(null);
  const doneRef = useRef(onFocusDone);
  doneRef.current = onFocusDone;

  // A jump: open the entry first (the next render shows its fields), then find the field and put the cursor in it.
  const nonce = focus && focus.module === meta.module ? focus.nonce : null;
  useEffect(() => {
    if (nonce === null || !focus) return;
    let path: string;
    if (meta.repeatable) {
      const index = focus.entry;
      if (index === undefined || index < 0 || index >= entries.length) {
        if (addRef.current) revealField(addRef.current);
        doneRef.current?.();
        return;
      }
      if (openIndex !== index) {
        setOpenIndex(index);
        return;
      }
      path = `${module}.${index}.${focus.field}`;
    } else {
      path = meta.container === 'root' ? focus.field : `${meta.module}.${focus.field}`;
    }
    const target = findFieldTarget(rootRef.current, path);
    if (target) revealField(target);
    doneRef.current?.();
    // Runs again only for a new jump or once the entry has opened.
  }, [nonce, openIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!meta.repeatable) {
    const base = meta.container === 'root' ? '' : meta.module;
    return (
      <section ref={setRoot} className="m-card m-card--padded">
        <Fields meta={meta} base={base} resume={resume} issues={issues} edit={edit} />
      </section>
    );
  }

  const name = t(meta.labelKey);
  const entryName = (index: number) => t('options.entry', { name, n: index + 1 });

  const add = () => {
    edit((r) => addEntry(r, module));
    setOpenIndex(entries.length);
  };
  const move = (index: number, delta: -1 | 1) => {
    edit((r) => moveEntry(r, module, index, delta));
    if (openIndex === index) setOpenIndex(index + delta);
    else if (openIndex === index + delta) setOpenIndex(index);
    setMenuIndex(null);
  };
  const remove = (index: number) => {
    const removed = entries[index] as never;
    edit((r) => removeEntry(r, module, index));
    if (openIndex === index) setOpenIndex(null);
    else if (openIndex !== null && openIndex > index) setOpenIndex(openIndex - 1);
    setMenuIndex(null);
    showToast({
      text: t('options.entryRemoved', { name: entryName(index) }),
      action: { label: t('options.undo'), onClick: () => edit((r) => insertEntry(r, module, index, removed)) },
    });
  };

  return (
    <div className="m-entries" ref={setRoot}>
      {entries.length === 0 ? <p className="m-empty">{t('options.noEntries', { name })}</p> : null}
      {entries.map((entry, index) => {
        const open = openIndex === index;
        const summary = entrySummary(meta, entry);
        return (
          // Entries have no stable id; the whole list re-renders on every edit, so index keys are fine.
          <section key={index} className="m-card m-entry" aria-label={entryName(index)}>
            <div className="m-entry__head">
              <button
                type="button"
                className="m-entry__toggle"
                aria-expanded={open}
                onClick={() => setOpenIndex(open ? null : index)}
              >
                <span className="m-entry__name">{entryName(index)}</span>
                {summary ? <span className="m-entry__summary">{summary}</span> : null}
                <Icon name={open ? 'chevron-up' : 'chevron-down'} />
              </button>
              <IconButton icon="three-dots" label={t('m.more', { name: entryName(index) })} onClick={() => setMenuIndex(index)} />
            </div>
            {open ? (
              <div className="m-entry__body">
                <Fields meta={meta} base={`${module}.${index}`} resume={resume} issues={issues} edit={edit} />
              </div>
            ) : null}
          </section>
        );
      })}
      <button ref={addRef} type="button" className="m-button m-button--wide" onClick={add}>
        <Icon name="plus-lg" />
        <span>{t('options.add', { name })}</span>
      </button>
      <Sheet open={menuIndex !== null} title={menuIndex !== null ? entryName(menuIndex) : ''} onClose={() => setMenuIndex(null)}>
        {menuIndex !== null ? (
          <div className="m-actions">
            {menuIndex > 0 ? <SheetAction icon="arrow-up" label={t('options.moveUp')} onClick={() => move(menuIndex, -1)} /> : null}
            {menuIndex < entries.length - 1 ? (
              <SheetAction icon="arrow-down" label={t('options.moveDown')} onClick={() => move(menuIndex, 1)} />
            ) : null}
            <SheetAction icon="trash" label={t('options.removeEntry')} danger onClick={() => remove(menuIndex)} />
          </div>
        ) : null}
      </Sheet>
    </div>
  );
}
