// 核对导入的内容: one column. A summary with 只看需要核对的, the target card, then each module as a section, list
// modules one card per entry, and a sticky bottom bar with 取消 and 导入 n 项 / 合并 n 项. Values the schema refuses
// are worked out shortly after each change and shown on their rows; the action then moves the cursor to the first.
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { MODULES, type ModuleMeta, type ModuleName } from '../../../../src/editor';
import { refusedPaths } from '../../../../src/import/draft';
import type { Profile } from '../../../../src/schema';
import { Notice } from '../dialogs';
import { Icon, MODULE_ICONS } from '../Icon';
import { useMT } from '../i18n';
import { entrySummary } from '../ModuleScreen';
import { useKeyboardOpen } from '../TabBar';
import { IconButton } from '../ui';
import { planMerge, type MergePlan } from './merge';
import { describePath } from './paths';
import { groupsOf, summaryOf, toDraft, type ReviewAction, type ReviewGroup, type ReviewState } from './review';
import { ReviewEntryCard } from './ReviewEntryCard';
import { ReviewFieldRow } from './ReviewFieldRow';
import { TargetCard } from './TargetCard';

/** Refused values are worked out this long after the last change. */
const REFUSED_DELAY_MS = 150;

/** Draft paths (as read) whose value the schema refuses, for the kept items of kept entries. */
export function refusedOf(state: ReviewState): string[] {
  const { draft, pathMap } = toDraft(state);
  const back = new Map<string, string>();
  for (const [original, dense] of pathMap) back.set(dense, original);
  const title = (state.target.kind === 'new' ? state.target.title.trim() : '') || 'resume';
  return refusedPaths(draft, { id: 'review', title }).map((path) => back.get(path) ?? path);
}

/** The merge plan for the review's merge target, or null for a new resume (or a target that is gone). */
export function planOf(state: ReviewState, profile: Profile | null): MergePlan | null {
  if (state.target.kind !== 'merge') return null;
  const resumeId = state.target.resumeId;
  const target = profile?.resumes.find((r) => r.id === resumeId);
  return target ? planMerge(state, target) : null;
}

export interface ReviewScreenProps {
  state: ReviewState;
  dispatch: (action: ReviewAction) => void;
  profile: Profile | null;
  /** Applying: the bar says so and nothing can be changed. */
  busy: boolean;
  /** The merge target was deleted meanwhile; the target is now a new resume. */
  targetGone?: boolean;
  headingId: string;
  /** Back and 取消. */
  onCancel: () => void;
  /** 导入 / 合并, once nothing is refused and something will be written. */
  onSubmit: () => void;
}

export function ReviewScreen({ state, dispatch, profile, busy, targetGone = false, headingId, onCancel, onSubmit }: ReviewScreenProps) {
  const t = useMT();
  const keyboard = useKeyboardOpen();
  const barHelpId = useId();
  const summary = summaryOf(state);
  const groups = groupsOf(state);
  const plan = useMemo(() => planOf(state, profile), [state, profile]);
  const count = state.target.kind === 'merge' ? (plan?.willWrite ?? 0) : summary.willWrite;

  const [refused, setRefused] = useState<string[]>([]);
  useEffect(() => {
    const timer = setTimeout(() => setRefused(refusedOf(state)), REFUSED_DELAY_MS);
    return () => clearTimeout(timer);
  }, [state]);
  const refusedSet = useMemo(() => new Set(refused), [refused]);

  const controls = useRef(new Map<string, HTMLElement>());
  const [focusPath, setFocusPath] = useState<string | null>(null);
  useEffect(() => {
    if (!focusPath) return;
    const el = controls.current.get(focusPath);
    if (el) {
      el.focus();
      setFocusPath(null);
    }
  }, [focusPath, state.onlyCheck]);

  const submit = () => {
    if (busy) return;
    const current = refusedOf(state);
    if (current.length > 0) {
      setRefused(current);
      const set = new Set(current);
      const first = state.items.find((item) => set.has(item.path));
      if (first) {
        if (!controls.current.has(first.path) && state.onlyCheck) dispatch({ type: 'onlyCheck', on: false });
        setFocusPath(first.path);
      }
      return;
    }
    if (count === 0) return;
    onSubmit();
  };

  // Module sections in editor order; an entry's summary is made from all it read, whatever is filtered.
  const sections: Array<{ meta: ModuleMeta; groups: ReviewGroup[] }> = [];
  for (const meta of MODULES) {
    const of = groups.filter((g) => g.module === meta.module);
    if (of.length > 0) sections.push({ meta, groups: of });
  }
  const summaryOfEntry = (meta: ModuleMeta, module: ModuleName, entry: number) => {
    const values: Record<string, unknown> = {};
    for (const item of state.items) {
      if (item.module !== module || item.entry !== entry || item.hidden) continue;
      const field = describePath(item.path)?.field;
      if (field) values[field.key] = item.value;
    }
    return entrySummary(meta, values);
  };
  const overwrite = new Set(state.overwrite);
  const changes = new Map((plan?.changes ?? []).map((c) => [c.path, c]));
  const rows = (group: ReviewGroup) =>
    group.items.map((item) => (
      <ReviewFieldRow
        key={item.path}
        item={item}
        lines={state.lines}
        dispatch={dispatch}
        change={changes.get(item.path) ?? null}
        overwrite={overwrite.has(item.path)}
        refused={refusedSet.has(item.path)}
        disabled={busy}
        controlRef={(el) => {
          if (el) controls.current.set(item.path, el);
          else controls.current.delete(item.path);
        }}
      />
    ));

  const action = t(state.target.kind === 'merge' ? 'm.ri.merge' : 'm.ri.import', { n: count });
  const barHelp = refused.length > 0 ? t('m.ri.fixFirst', { n: refused.length }) : count === 0 ? t('m.ri.nothing') : null;
  const docLanguage = t(state.language.locale.startsWith('zh') ? 'm.ri.lang.zh' : 'm.ri.lang.en');

  return (
    <>
      <header className="m-header m-header--module">
        <IconButton icon="arrow-left" label={t('m.back')} onClick={onCancel} />
        <h1 id={headingId} className="m-title" tabIndex={-1}>
          {t('m.ri.reviewTitle')}
        </h1>
      </header>
      <div className="m-ri-body">
        {state.file.name ? <p className="m-help m-ri-from">{t('m.ri.from', { name: state.file.name })}</p> : null}
        <section className="m-card m-card--padded m-ri-summary">
          <p className="m-ri-summary__text">
            {summary.toCheck > 0
              ? t('m.ri.summary', { n: summary.recognised, m: summary.toCheck })
              : t('m.ri.summarySure', { n: summary.recognised })}
          </p>
          {/* Kept while on: turning the last field to check off must not strand the filter with no way back. */}
          {summary.toCheck > 0 || state.onlyCheck ? (
            <label className="m-ri-switch m-ri-switch--line">
              <input
                type="checkbox"
                role="switch"
                checked={state.onlyCheck}
                onChange={(e) => dispatch({ type: 'onlyCheck', on: e.target.checked })}
              />
              <span className="m-ri-switch__track" aria-hidden="true" />
              <span className="m-ri-switch__text">{t('m.ri.onlyCheck')}</span>
            </label>
          ) : null}
          {state.language.mixed ? (
            // Only a new resume has a language to change; a merge keeps the target's.
            <Notice>{t(state.target.kind === 'new' ? 'm.ri.mixed' : 'm.ri.mixedMerge', { language: docLanguage })}</Notice>
          ) : null}
        </section>

        <TargetCard state={state} profile={profile} dispatch={dispatch} targetGone={targetGone} disabled={busy} />

        {sections.map(({ meta, groups: moduleGroups }) => (
          <section key={meta.module} className="m-ri-section" aria-labelledby={`${headingId}-${meta.module}`}>
            <h2 id={`${headingId}-${meta.module}`} className="m-section-title m-ri-section__title">
              <Icon name={MODULE_ICONS[meta.module]} />
              <span>{t(meta.labelKey)}</span>
            </h2>
            {moduleGroups.map((group) =>
              group.entry === null ? (
                <div key={group.key} className="m-card m-card--padded m-ri-entry__rows">
                  {rows(group)}
                </div>
              ) : (
                <ReviewEntryCard
                  key={group.key}
                  entryKey={group.key}
                  title={t('m.ri.entryTitle', { module: t(meta.labelKey), n: group.entry + 1 })}
                  summary={summaryOfEntry(meta, group.module, group.entry)}
                  dropped={group.dropped}
                  planned={plan?.entries.find((e) => e.key === group.key) ?? null}
                  disabled={busy}
                  onDrop={() => dispatch({ type: 'dropEntry', key: group.key })}
                  onRestore={() => dispatch({ type: 'restoreEntry', key: group.key })}
                >
                  {rows(group)}
                </ReviewEntryCard>
              ),
            )}
          </section>
        ))}
      </div>
      <div className="m-ri-bar" hidden={keyboard || undefined}>
        {barHelp ? (
          <p className={refused.length > 0 ? 'm-help m-help--error m-ri-bar__help' : 'm-help m-ri-bar__help'} id={barHelpId}>
            {barHelp}
          </p>
        ) : null}
        <button type="button" className="m-button" disabled={busy} onClick={onCancel}>
          {t('common.cancel')}
        </button>
        <button
          type="button"
          className="m-button m-button--primary"
          aria-busy={busy || undefined}
          aria-describedby={barHelp ? barHelpId : undefined}
          disabled={busy || (count === 0 && refused.length === 0)}
          onClick={submit}
        >
          {action}
        </button>
      </div>
    </>
  );
}
