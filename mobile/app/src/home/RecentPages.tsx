// Home, block C: recent application pages, newest first. A row opens the page in the fill browser; its ⋯ button opens
// a sheet with the full link (open, copy, remove). The list can be cleared after a confirm. Undo for remove and clear
// lives in the toast (HomeScreen).
import { useId, useState } from 'react';
import { useLanguage } from '../../../../src/i18n';
import { ConfirmSheet } from '../dialogs';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { RecentPage } from '../store/appStateStore';
import { IconButton, Sheet, SheetAction, type ToastMessage } from '../ui';
import { relativeTime } from './relativeTime';

export interface RecentPagesProps {
  pages: readonly RecentPage[];
  now: number;
  onOpen: (page: RecentPage) => void;
  onRemove: (page: RecentPage) => void;
  onClear: () => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export function RecentPages({ pages, now, onOpen, onRemove, onClear, showToast }: RecentPagesProps) {
  const t = useMT();
  const language = useLanguage();
  const headingId = useId();
  const rowId = useId();
  const [openId, setOpenId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const open = pages.find((p) => p.id === openId) ?? null;

  const copy = async (url: string) => {
    try {
      if (typeof navigator.clipboard?.writeText !== 'function') throw new Error('no clipboard');
      await navigator.clipboard.writeText(url);
      showToast({ text: t('m.recent.copied') });
    } catch {
      showToast({ text: t('m.recent.copyFailed') });
    }
  };

  return (
    <section className="m-recent">
      <div className="m-recent__head">
        <h2 id={headingId}>{t('m.recent.title')}</h2>
        {pages.length > 0 ? (
          <button type="button" className="m-button m-button--text" onClick={() => setConfirming(true)}>
            {t('m.recent.clear')}
          </button>
        ) : null}
      </div>
      {pages.length === 0 ? (
        <p className="m-empty">{t('m.recent.empty')}</p>
      ) : (
        <ul className="m-card m-recent__list" aria-label={t('m.recent.title')}>
          {pages.map((p, i) => (
            <li key={p.id} className="m-recent__row">
              <button
                type="button"
                className="m-recent__open"
                aria-label={t('m.recent.open', { host: p.host })}
                aria-describedby={`${rowId}-${i}`}
                onClick={() => onOpen(p)}
              >
                <span className="m-row__tile">
                  <Icon name="link-45deg" />
                </span>
                <span className="m-row__text" id={`${rowId}-${i}`}>
                  <span className="m-recent__host">{p.host}</span>
                  {p.title ? <span className="m-row__caption">{p.title}</span> : null}
                  <span className="m-recent__meta">{relativeTime(p.addedAt, now, language)}</span>
                </span>
              </button>
              <IconButton icon="three-dots" label={t('m.recent.more', { host: p.host })} onClick={() => setOpenId(p.id)} />
            </li>
          ))}
        </ul>
      )}

      <Sheet open={open !== null} title={t('m.recent.detailTitle')} onClose={() => setOpenId(null)}>
        {open ? (
          <div className="m-sheet-stack">
            <p className="m-recent__host">{open.host}</p>
            {open.title ? <p className="m-sheet-text">{open.title}</p> : null}
            <p className="m-url">{open.url}</p>
            <div className="m-actions">
              <SheetAction
                icon="window"
                label={t('m.recent.openOne')}
                onClick={() => {
                  setOpenId(null);
                  onOpen(open);
                }}
              />
              <SheetAction icon="copy" label={t('m.recent.copy')} onClick={() => void copy(open.url)} />
              <SheetAction
                icon="x-lg"
                label={t('m.recent.removeOne')}
                onClick={() => {
                  setOpenId(null);
                  onRemove(open);
                }}
              />
            </div>
          </div>
        ) : null}
      </Sheet>

      <ConfirmSheet
        open={confirming}
        title={t('m.recent.clearTitle')}
        text={t('m.recent.clearText', { n: pages.length })}
        confirmLabel={t('m.recent.clearConfirm')}
        danger
        onConfirm={() => {
          setConfirming(false);
          onClear();
        }}
        onClose={() => setConfirming(false)}
      />
    </section>
  );
}
