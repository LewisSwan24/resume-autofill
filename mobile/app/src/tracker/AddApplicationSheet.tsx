// Add an application by hand: a link (checked like the paste box), company and position. Nothing is
// loaded in the browser; the new record's detail opens. A link already listed opens that record instead.
import { useId, useState } from 'react';
import { parseApplicationLink } from '../home/pasteLink';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { AppState } from '../store/appStateStore';
import { Sheet, type ToastMessage } from '../ui';
import { addManual } from './model/records';
import './tracker.css';

export interface AddApplicationSheetProps {
  open: boolean;
  onClose: () => void;
  appState: AppState;
  updateAppState: (change: (s: AppState) => AppState) => Promise<boolean>;
  onOpenDetail: (id: string) => void;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
  now: () => number;
}

export function AddApplicationSheet(props: AddApplicationSheetProps) {
  const t = useMT();
  return (
    <Sheet open={props.open} title={t('m.add.title')} onClose={props.onClose}>
      <AddBody {...props} />
    </Sheet>
  );
}

function AddBody({ onClose, appState, updateAppState, onOpenDetail, showToast, now }: AddApplicationSheetProps) {
  const t = useMT();
  const ids = useId();
  const [link, setLink] = useState('');
  const [company, setCompany] = useState('');
  const [position, setPosition] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (busy) return;
    const parsed = parseApplicationLink(link);
    if (!parsed.ok) {
      setError(t(`m.paste.err.${parsed.code}`));
      document.getElementById(`${ids}-link`)?.focus();
      return;
    }
    const page = { url: parsed.url, host: parsed.host, company, position };
    const at = now();
    const planned = addManual(appState, page, at);
    if (planned.existed) {
      onClose();
      onOpenDetail(planned.id);
      showToast({ text: t('m.add.exists') });
      return;
    }
    setBusy(true);
    let id = planned.id;
    const ok = await updateAppState((s) => {
      const r = addManual(s, page, at, () => planned.id);
      id = r.id;
      return r.state;
    });
    setBusy(false);
    if (!ok) {
      showToast({ text: t('m.saveStateFailed') });
      return;
    }
    onClose();
    onOpenDetail(id);
  };

  return (
    <form
      className="m-sheet-stack"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      <div className="m-field">
        <label className="m-label" htmlFor={`${ids}-link`}>
          {t('m.add.link')}
        </label>
        <input
          id={`${ids}-link`}
          className="m-input"
          type="url"
          inputMode="url"
          autoComplete="off"
          placeholder={t('m.paste.placeholder')}
          value={link}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${ids}-error` : undefined}
          onChange={(e) => {
            setLink(e.target.value);
            setError(null);
          }}
        />
        {error ? (
          <p id={`${ids}-error`} className="m-help m-help--error" role="alert">
            <Icon name="exclamation-circle" />
            <span>{error}</span>
          </p>
        ) : null}
      </div>
      <div className="m-field">
        <label className="m-label" htmlFor={`${ids}-company`}>
          {t('m.app.company')}
        </label>
        <input id={`${ids}-company`} className="m-input" maxLength={80} value={company} onChange={(e) => setCompany(e.target.value)} />
      </div>
      <div className="m-field">
        <label className="m-label" htmlFor={`${ids}-position`}>
          {t('m.app.position')}
        </label>
        <input
          id={`${ids}-position`}
          className="m-input"
          maxLength={80}
          placeholder={t('m.app.positionHint')}
          value={position}
          onChange={(e) => setPosition(e.target.value)}
        />
      </div>
      <button type="submit" className="m-button m-button--primary m-button--wide" aria-busy={busy || undefined}>
        <Icon name="plus-lg" />
        <span>{t('m.add.save')}</span>
      </button>
    </form>
  );
}
