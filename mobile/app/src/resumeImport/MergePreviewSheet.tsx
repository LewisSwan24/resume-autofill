// 合并前看一下: what a merge will do, before it does it. Each line only when its count is above zero; the filled
// labels and the overwrites can be read in full.
import { useLanguage } from '../../../../src/i18n';
import { useMT } from '../i18n';
import { Sheet } from '../ui';
import type { MergePlan } from './merge';
import type { ReviewState } from './review';
import { labelOf, shownValue } from './ReviewFieldRow';

export interface MergePreviewSheetProps {
  open: boolean;
  plan: MergePlan | null;
  state: ReviewState | null;
  busy: boolean;
  onConfirm: () => void;
  onClose: () => void;
}

export function MergePreviewSheet({ open, plan, state, busy, onConfirm, onClose }: MergePreviewSheetProps) {
  const t = useMT();
  const language = useLanguage();
  const overwrite = new Set(state?.overwrite ?? []);
  const fills = plan ? plan.changes.filter((c) => c.kind === 'fill') : [];
  const overwrites = plan ? plan.changes.filter((c) => c.kind === 'conflict' && overwrite.has(c.path)) : [];
  return (
    <Sheet open={open && plan !== null} title={t('m.ri.previewTitle')} onClose={onClose}>
      {plan ? (
        <div className="m-sheet-stack">
          <ul className="m-ri-preview">
            {plan.counts.fill > 0 ? (
              <li>
                <details className="m-ri-preview__more">
                  <summary>{t('m.ri.preview.fill', { n: plan.counts.fill })}</summary>
                  <ul>
                    {fills.map((c) => (
                      <li key={c.path}>{labelOf(c.path, t)}</li>
                    ))}
                  </ul>
                </details>
              </li>
            ) : null}
            {plan.counts.overwrite > 0 ? (
              <li>
                <span>{t('m.ri.preview.overwrite', { n: plan.counts.overwrite })}</span>
                <ul>
                  {overwrites.map((c) => (
                    <li key={c.path}>
                      {t('m.ri.preview.change', {
                        field: labelOf(c.path, t),
                        from: shownValue(c.path, c.existing, language),
                        to: shownValue(c.path, c.incoming, language),
                      })}
                    </li>
                  ))}
                </ul>
              </li>
            ) : null}
            {plan.counts.added > 0 ? <li>{t('m.ri.preview.added', { n: plan.counts.added })}</li> : null}
            {plan.counts.keepExisting > 0 ? <li>{t('m.ri.preview.kept', { n: plan.counts.keepExisting })}</li> : null}
          </ul>
          <button
            type="button"
            className="m-button m-button--primary m-button--wide"
            aria-busy={busy || undefined}
            disabled={busy}
            onClick={onConfirm}
          >
            {t('m.ri.preview.confirm')}
          </button>
          <button type="button" className="m-button m-button--wide" disabled={busy} onClick={onClose}>
            {t('m.ri.preview.back')}
          </button>
        </div>
      ) : null}
    </Sheet>
  );
}
