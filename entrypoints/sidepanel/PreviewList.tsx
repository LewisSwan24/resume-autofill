// Side panel pre-fill preview list: review planned fields, toggle inclusion, edit text overrides, and commit.
import { useEffect, useMemo, useState } from 'react';
import type { FillPreview, PreviewItem } from '../../src/engine/types';
import { useT } from '../../src/i18n';
import { IconButton, Notice } from './parts';

export interface PreviewCommitPayload {
  excludedByFrame: Record<number, string[]>;
  overridesByFrame: Record<number, Record<string, string>>;
}

interface PreviewListProps {
  preview: FillPreview;
  busy: boolean;
  onFocus: (frameId: number, fieldId: string) => void;
  onCommit: (payload: PreviewCommitPayload) => void;
  onCancel: () => void;
}

const rowKey = (item: Pick<PreviewItem, 'frameId' | 'fieldId'>): string => `${item.frameId ?? 0}:${item.fieldId}`;

export function PreviewList({ preview, busy, onFocus, onCommit, onCancel }: PreviewListProps) {
  const t = useT();
  const [excluded, setExcluded] = useState<Set<string>>(() => new Set());
  const [overrides, setOverrides] = useState<Record<string, string>>({});

  useEffect(() => {
    setExcluded(new Set());
    setOverrides({});
  }, [preview.createdAt]);

  const selectedCount = preview.items.filter((i) => !excluded.has(rowKey(i))).length;
  const extraCards = useMemo(
    () => preview.cardDemand.reduce((sum, d) => sum + Math.max(0, d.need - d.have), 0),
    [preview.cardDemand],
  );

  const toggle = (key: string) => {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (!next.delete(key)) next.add(key);
      return next;
    });
  };

  const submit = () => {
    const excludedByFrame: Record<number, string[]> = {};
    const overridesByFrame: Record<number, Record<string, string>> = {};
    for (const item of preview.items) {
      const frameId = item.frameId ?? 0;
      const key = rowKey(item);
      if (excluded.has(key)) {
        (excludedByFrame[frameId] ??= []).push(item.fieldId);
      } else if (Object.hasOwn(overrides, key) && overrides[key] !== item.value) {
        (overridesByFrame[frameId] ??= {})[item.fieldId] = overrides[key]!;
      }
    }
    onCommit({ excludedByFrame, overridesByFrame });
  };

  return (
    <section className="raf-preview" aria-label={t('panel.preview.title')} data-testid="raf-preview-panel">
      <div className="raf-overview">
        <p className="raf-summary">{t('panel.preview.title')}</p>
        <p className="raf-preview-lead">{t('panel.preview.lead', { n: preview.items.length })}</p>
        {extraCards > 0 ? <Notice>{t('panel.preview.cards', { n: extraCards })}</Notice> : null}
        {preview.unresolvedCount > 0 ? (
          <p className="raf-preview-note">{t('panel.preview.unresolved', { n: preview.unresolvedCount })}</p>
        ) : null}
        <div className="raf-preview-actions">
          <button
            type="button"
            className="raf-btn raf-btn--primary"
            disabled={busy}
            onClick={submit}
            data-testid="raf-preview-confirm"
          >
            {t('panel.preview.confirm', { n: selectedCount })}
          </button>
          <button type="button" className="raf-btn" disabled={busy} onClick={onCancel}>
            {t('panel.preview.cancel')}
          </button>
        </div>
      </div>

      <ul className="raf-preview-list">
        {preview.items.map((item) => {
          const key = rowKey(item);
          const checked = !excluded.has(key);
          const value = Object.hasOwn(overrides, key) ? overrides[key]! : item.value;
          const editable = item.kind === 'text';
          return (
            <li key={key} className="raf-tile raf-preview-row" data-excluded={!checked}>
              <div className="raf-preview-row__head">
                <label className="raf-preview-check">
                  <input
                    type="checkbox"
                    checked={checked}
                    aria-label={t('panel.preview.toggle', { label: item.label })}
                    onChange={() => toggle(key)}
                  />
                  <span className="raf-preview-label">{item.label}</span>
                </label>
                <IconButton
                  icon="search"
                  label={t('panel.locate')}
                  onClick={() => onFocus(item.frameId ?? 0, item.fieldId)}
                />
              </div>
              {editable ? (
                <input
                  type="text"
                  className="raf-preview-input"
                  value={value}
                  disabled={!checked || busy}
                  aria-label={t('panel.editInput', { label: item.label })}
                  onChange={(e) => setOverrides((prev) => ({ ...prev, [key]: e.target.value }))}
                />
              ) : (
                <p className="raf-preview-value">{value}</p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
