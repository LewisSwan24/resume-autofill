// A page tried to leave http(s) after a tap. tel: / mailto: / sms: ask before opening the dialer or a
// composer (never dialled or sent); app schemes only offer the link to copy, never launch; an intent: with a web
// fallback offers to load it here.
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { DockedSheet } from './DockedSheet';
import type { ExternalDecision } from './model/urlPolicy';

export type AskDecision = Exclude<ExternalDecision, { action: 'ignore' } | { action: 'blocked' }>;

export interface ExternalLinkSheetProps {
  decision: AskDecision | null;
  onOpen: () => void;
  onCopy: (url: string) => void;
  onClose: () => void;
}

const ASK = {
  call: { title: 'm.br.ext.callTitle', text: 'm.br.ext.callText' },
  mail: { title: 'm.br.ext.mailTitle', text: 'm.br.ext.mailText' },
  sms: { title: 'm.br.ext.smsTitle', text: 'm.br.ext.smsText' },
} as const;

export function ExternalLinkSheet({ decision, onOpen, onCopy, onClose }: ExternalLinkSheetProps) {
  const t = useMT();
  const title = !decision
    ? ''
    : decision.action === 'ask'
      ? t(ASK[decision.kind].title)
      : decision.action === 'app'
        ? t('m.br.ext.appTitle')
        : t('m.br.ext.fallbackTitle');
  return (
    <DockedSheet open={decision !== null} title={title} modal onClose={onClose}>
      {decision?.action === 'ask' ? (
        <div className="m-sheet-stack">
          <p className="m-sheet-text">{t(ASK[decision.kind].text, { target: decision.target })}</p>
          <p className="m-br-target">{decision.target}</p>
          <button type="button" className="m-button m-button--primary m-button--wide" onClick={onOpen}>
            {t('m.br.ext.open')}
          </button>
          <button type="button" className="m-button m-button--wide" onClick={onClose}>
            {t('m.br.cancel')}
          </button>
        </div>
      ) : decision?.action === 'app' ? (
        <div className="m-sheet-stack">
          <p className="m-sheet-text">{t('m.br.ext.appText', { app: t(`m.br.ext.app.${decision.app ?? 'other'}`) })}</p>
          <p className="m-url">{decision.url}</p>
          <button type="button" className="m-button m-button--wide" onClick={() => onCopy(decision.url)}>
            <Icon name="copy" />
            <span>{t('m.br.copyLink')}</span>
          </button>
        </div>
      ) : decision?.action === 'fallback' ? (
        <div className="m-sheet-stack">
          <p className="m-sheet-text">{t('m.br.ext.fallbackText', { host: decision.host })}</p>
          <button type="button" className="m-button m-button--primary m-button--wide" onClick={onOpen}>
            {t('m.br.ext.fallbackOpen')}
          </button>
          <button type="button" className="m-button m-button--wide" onClick={onClose}>
            {t('m.br.cancel')}
          </button>
        </div>
      ) : null}
    </DockedSheet>
  );
}
