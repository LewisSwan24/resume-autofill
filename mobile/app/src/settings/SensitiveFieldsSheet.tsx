// How a fill treats identity numbers: write them like any other field, or leave them empty and remind (the
// default). One choice for the phone and the extension: it lives in profile.settings.sensitiveFields and the one
// made last wins in sync and import. The choices are shared by the 设置 sheet and the fill browser's docked sheet.
import { SENSITIVE_FIELD_MODES, type SensitiveFieldMode } from '../../../../src/schema/sensitive';
import { DockedSheet } from '../browser/DockedSheet';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { Sheet } from '../ui';

export const SENSITIVE_LABELS: Record<SensitiveFieldMode, string> = {
  fill: 'options.settings.sensitiveFill',
  remind: 'options.settings.sensitiveRemind',
};
const HINTS: Record<SensitiveFieldMode, string> = { fill: 'm.sensitive.fillHint', remind: 'm.sensitive.remindHint' };

function SensitiveChoices({ value, onChoose, onClose }: { value: SensitiveFieldMode; onChoose: (v: SensitiveFieldMode) => void; onClose: () => void }) {
  const t = useMT();
  return (
    <div className="m-sheet-stack">
      <p className="m-help">{t('m.sensitive.which')}</p>
      <div role="radiogroup" aria-label={t('m.sensitive.title')} className="m-choices">
        {SENSITIVE_FIELD_MODES.map((v) => {
          const checked = v === value;
          return (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={checked}
              className={checked ? 'm-choice m-choice--on' : 'm-choice'}
              onClick={() => {
                if (!checked) onChoose(v);
                onClose();
              }}
            >
              <span className="m-choice__text">
                <span className="m-row__name">{t(SENSITIVE_LABELS[v])}</span>
                <span className="m-row__caption">{t(HINTS[v])}</span>
              </span>
              {checked ? <Icon name="check-lg" /> : null}
            </button>
          );
        })}
      </div>
      <p className="m-notice">
        <Icon name="laptop" />
        <span>{t('m.sensitive.sync')}</span>
      </p>
    </div>
  );
}

export interface SensitiveFieldsSheetProps {
  open: boolean;
  value: SensitiveFieldMode;
  onChoose: (value: SensitiveFieldMode) => void;
  onClose: () => void;
}

/** In 设置. */
export function SensitiveFieldsSheet({ open, value, onChoose, onClose }: SensitiveFieldsSheetProps) {
  const t = useMT();
  return (
    <Sheet open={open} title={t('m.sensitive.title')} onClose={onClose}>
      <SensitiveChoices value={value} onChoose={onChoose} onClose={onClose} />
    </Sheet>
  );
}

/** In the fill browser, from a held-back row's 「改设置」: the page stays where it is. */
export function SensitiveFieldsDockedSheet({ open, value, onChoose, onClose }: SensitiveFieldsSheetProps) {
  const t = useMT();
  return (
    <DockedSheet open={open} title={t('m.sensitive.title')} modal onClose={onClose}>
      <SensitiveChoices value={value} onChoose={onChoose} onClose={onClose} />
    </DockedSheet>
  );
}
