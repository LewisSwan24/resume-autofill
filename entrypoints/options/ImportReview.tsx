// The check before anything is stored: what the file says on the left, what was read from it on the right.
// Everything here is local state. Only the save button writes, and it writes a new resume.
import { useEffect, useMemo, useState } from 'react';
import { enumOptions } from '../../src/editor';
import { useLanguage, useT, type MessageKey } from '../../src/i18n';
import type { TextLine } from '../../src/import/extract/types';
import type { Draft, DraftField } from '../../src/import/parse';
import { titleFromFileName } from '../../src/import/parse/clean';
import { LOCALES, type Locale } from '../../src/schema';
import { Button, Field, Input, Notice, Segmented, SelectInput, Textarea } from './ui/controls';

/** Why the last save stored nothing. */
export type ReviewProblem = { kind: 'store' } | { kind: 'other_resume' } | { kind: 'fields'; paths: string[] };

interface Props {
  fileName: string;
  lines: TextLine[];
  draft: Draft;
  /** The name, when it has been changed once already. */
  title?: string;
  busy?: boolean;
  problem?: ReviewProblem | undefined;
  onCancel: () => void;
  onSave: (draft: Draft, title: string) => void;
  /** Told of every change. This page can go away while the applicant looks at another tab. */
  onEdit?: (draft: Draft, title: string) => void;
}

const PROBLEM_TEXT: Record<ReviewProblem['kind'], MessageKey> = {
  store: 'options.import.saveFailed',
  other_resume: 'options.import.fixOther',
  fields: 'options.import.fixFields',
};

/** Read as a choice, with the codes a resume keeps. */
const ENUM_OF: Record<string, string> = { degree: 'degree', gender: 'gender', politicalStatus: 'politicalStatus', maritalStatus: 'maritalStatus' };
/** Not for showing: whether a job is current follows from its end date being empty, and its kind from its section. */
const HIDDEN = new Set(['current', 'kind']);

const MODULE_ORDER = ['basics', 'contact', 'education', 'work', 'projects', 'skills', 'selfIntroduction'];

interface Group {
  key: string;
  module: string;
  /** 1 for the first entry of a list. Null for a module that is not a list. */
  entry: number | null;
  fields: { field: DraftField; index: number }[];
}

function groupsOf(fields: DraftField[]): Group[] {
  const groups = new Map<string, Group>();
  fields.forEach((field, index) => {
    const parts = field.path.split('.');
    if (HIDDEN.has(parts[parts.length - 1]!)) return;
    const entry = parts[1] !== undefined && /^\d+$/.test(parts[1]) ? Number(parts[1]) : null;
    const key = entry === null ? parts[0]! : `${parts[0]}.${entry}`;
    let group = groups.get(key);
    if (!group) groups.set(key, (group = { key, module: parts[0]!, entry: entry === null ? null : entry + 1, fields: [] }));
    group.fields.push({ field, index });
  });
  return [...groups.values()].sort(
    (a, b) => MODULE_ORDER.indexOf(a.module) - MODULE_ORDER.indexOf(b.module) || (a.entry ?? 0) - (b.entry ?? 0),
  );
}

const lastOf = (path: string): string => path.split('.').pop()!;

export function ImportReview({ fileName, lines, draft, title: firstTitle, busy, problem, onCancel, onSave, onEdit }: Props) {
  const t = useT();
  const language = useLanguage();
  const [fields, setFields] = useState(draft.fields);
  const [locale, setLocale] = useState<Locale>(draft.locale);
  // A file can be named after what is in it.
  const [title, setTitle] = useState(firstTitle ?? titleFromFileName(fileName));
  // The file as it was read can hold what nobody wants on screen: it stays folded until asked for.
  const [sourceOpen, setSourceOpen] = useState(false);
  const [activeLine, setActiveLine] = useState<number | null>(null);
  const groups = useMemo(() => groupsOf(fields), [fields]);
  useEffect(() => onEdit?.({ locale, fields }, title), [locale, fields, title, onEdit]);
  const refused = problem?.kind === 'fields' ? problem.paths : [];
  const toCheck = fields.filter((f) => f.certainty === 'check' && !HIDDEN.has(lastOf(f.path))).length;

  const edit = (index: number, value: string) => setFields((prev) => prev.map((f, i) => (i === index ? { ...f, value } : f)));
  const showSource = (line: number) => {
    setActiveLine(line);
    document.getElementById(`raf-source-${line}`)?.scrollIntoView?.({ block: 'nearest' });
  };

  const fieldLabel = (path: string): string => {
    const name = lastOf(path);
    // A skill has a name, a native place has a city, and everything else has a field of the same name.
    if (path.startsWith('skills.')) return t('options.module.skills');
    if (path.startsWith('basics.nativePlace.')) return t('options.field.nativePlace');
    if (/^projects\.\d+\.name$/.test(path)) return t('options.module.projects');
    return t(`options.field.${name}` as MessageKey);
  };

  return (
    <section className="raf-review" aria-label={t('options.import.title')}>
      <div className="raf-review__head">
        <div>
          <h2 className="raf-heading">{t('options.import.title')}</h2>
          <p className="raf-caption">{t('options.import.lead', { name: fileName })}</p>
        </div>
        <div className="raf-review__actions">
          <Button onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" icon="check-lg" disabled={busy} onClick={() => onSave({ locale, fields }, title.trim() || fileName)}>
            {t('options.import.save')}
          </Button>
        </div>
      </div>

      {problem ? <Notice tone="danger">{t(PROBLEM_TEXT[problem.kind])}</Notice> : null}
      <Notice>{toCheck > 0 ? t('options.import.toCheck', { count: toCheck }) : t('options.import.nothingToCheck')}</Notice>

      <div className="raf-review__body">
        <div className="raf-review__source" tabIndex={0} role="region" aria-label={t('options.import.source')}>
          <h3 className="raf-subheading">{t('options.import.source')}</h3>
          <Notice>{t('options.import.sourceNote')}</Notice>
          <Button onClick={() => setSourceOpen((v) => !v)} aria-expanded={sourceOpen}>
            {t(sourceOpen ? 'options.import.sourceHide' : 'options.import.sourceShow')}
          </Button>
          {sourceOpen && (
            <ol className="raf-review__lines">
              {lines.map((line, i) => (
                <li key={i} id={`raf-source-${i}`} className={i === activeLine ? 'is-active' : undefined}>
                  {line.text}
                </li>
              ))}
            </ol>
          )}
        </div>

        <div className="raf-review__fields">
          <Field label={t('options.import.resumeTitle')}>
            {(control) => <Input {...control} value={title} onChange={(e) => setTitle(e.target.value)} />}
          </Field>
          <Segmented label={t('options.newLocale')} visibleLabel value={locale} options={LOCALES.map((l) => ({ value: l, label: l }))} onChange={setLocale} />

          {groups.map((group) => (
            <fieldset key={group.key} className="raf-review__group">
              <legend>
                {group.module === 'selfIntroduction' ? t('options.module.about') : t(`options.module.${group.module}` as MessageKey)}
                {group.entry !== null && group.module !== 'skills' ? ` ${group.entry}` : ''}
              </legend>
              {group.fields.map(({ field, index }) => {
                const name = lastOf(field.path);
                const domain = ENUM_OF[name];
                const cls = field.certainty === 'check' ? 'raf-review__field is-check' : 'raf-review__field';
                return (
                  <div key={field.path} className={cls} data-path={field.path} onFocusCapture={() => showSource(field.line)}>
                    <Field
                      label={fieldLabel(field.path)}
                      help={field.certainty === 'check' ? t('options.import.check') : undefined}
                      error={refused.includes(field.path) ? t('options.import.notValid') : null}
                    >
                      {(control) =>
                        domain ? (
                          <SelectInput {...control} value={field.value} onChange={(e) => edit(index, e.target.value)}>
                            <option value="">{t('common.unset')}</option>
                            {enumOptions(domain, language).map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </SelectInput>
                        ) : field.value.includes('\n') || name === 'description' ? (
                          <Textarea {...control} value={field.value} rows={4} onChange={(e) => edit(index, e.target.value)} />
                        ) : (
                          <Input {...control} value={field.value} onChange={(e) => edit(index, e.target.value)} />
                        )
                      }
                    </Field>
                  </div>
                );
              })}
            </fieldset>
          ))}
        </div>
      </div>
    </section>
  );
}
