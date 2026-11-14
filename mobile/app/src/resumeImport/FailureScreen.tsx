// Why a file could not be imported, in plain words, one title and body per reason, and what to do next: choose
// another file, start a blank resume (when the file was a scan, locked, or had nothing recognisable) or close.
import { Icon, type IconName } from '../Icon';
import { useMT } from '../i18n';
import { IconButton } from '../ui';
import type { ImportFailure } from './types';

const ICON: Record<ImportFailure, IconName> = {
  no_text: 'file-earmark-image',
  encrypted: 'file-earmark-lock',
  too_large: 'file-earmark-x',
  wrong_type: 'file-earmark-x',
  old_word: 'file-earmark-x',
  empty: 'file-earmark-x',
  unreadable: 'exclamation-triangle',
  failed: 'exclamation-triangle',
  nothing_found: 'exclamation-triangle',
};

/** Reasons where starting from a blank resume is a sensible next step. */
const OFFER_BLANK = new Set<ImportFailure>(['no_text', 'encrypted', 'nothing_found']);

export interface FailureScreenProps {
  headingId: string;
  reason: ImportFailure;
  fileName: string;
  onAnother: () => void;
  onBlank: () => void;
  onClose: () => void;
}

export function FailureScreen({ headingId, reason, fileName, onAnother, onBlank, onClose }: FailureScreenProps) {
  const t = useMT();
  return (
    <>
      <header className="m-header m-header--module">
        <IconButton icon="arrow-left" label={t('m.back')} onClick={onClose} />
        <h1 id={headingId} className="m-title" tabIndex={-1}>
          {t(`m.ri.fail.title.${reason}`)}
        </h1>
      </header>
      <div className="m-ri-body m-ri-fail">
        <span className="m-row__tile m-ri-fail__tile">
          <Icon name={ICON[reason]} />
        </span>
        <p className="m-prose">{t(`m.ri.fail.body.${reason}`)}</p>
        {fileName ? <p className="m-help m-ri-fail__file">{fileName}</p> : null}
        <div className="m-ri-fail__actions">
          <button type="button" className="m-button m-button--primary m-button--wide" onClick={onAnother}>
            <Icon name="file-earmark-pdf" />
            <span>{t('m.ri.fail.another')}</span>
          </button>
          {OFFER_BLANK.has(reason) ? (
            <button type="button" className="m-button m-button--wide" onClick={onBlank}>
              <Icon name="plus-lg" />
              <span>{t('m.ri.fail.blank')}</span>
            </button>
          ) : null}
          <button type="button" className="m-button m-button--wide" onClick={onClose}>
            {t('m.close')}
          </button>
        </div>
      </div>
    </>
  );
}
