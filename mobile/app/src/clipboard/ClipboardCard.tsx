// 「打开刚复制的链接？」 at the top of Home. Shows the host (and the title found in the copied text); one
// link opens at once, several go through the choice sheet. 不用了 remembers the links' digests, never the links.
import { useId } from 'react';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import type { ClipOffer } from './clipboardOffer';

export interface ClipboardCardProps {
  offer: ClipOffer;
  onOpen: () => void;
  onDismiss: () => void;
}

export function ClipboardCard({ offer, onOpen, onDismiss }: ClipboardCardProps) {
  const t = useMT();
  const titleId = useId();
  const many = offer.links.length > 1;
  const first = offer.links[0];
  const dismiss = () => {
    onDismiss();
    // The card is gone with the focused button: the Home heading takes the focus.
    document.querySelector<HTMLElement>('main h1')?.focus({ preventScroll: true });
  };
  return (
    <section className="m-card m-card--padded m-clip" aria-labelledby={titleId}>
      <div role="status">
        <h2 id={titleId} className="m-clip__title">
          <Icon name="clipboard" />
          <span>{many ? t('m.clip.many', { n: offer.links.length }) : t('m.clip.title')}</span>
        </h2>
      </div>
      {many ? (
        <ul className="m-clip__hosts">
          {offer.links.slice(0, 3).map((link) => (
            <li key={link.url}>{link.host}</li>
          ))}
        </ul>
      ) : first ? (
        <>
          <p className="m-clip__host">{first.host}</p>
          {first.title ? <p className="m-clip__page">{first.title}</p> : null}
        </>
      ) : null}
      <div className="m-clip__actions">
        <button type="button" className="m-button" aria-label={t('m.clip.dismissA11y')} onClick={dismiss}>
          {t('m.clip.dismiss')}
        </button>
        <button type="button" className="m-button m-button--primary" onClick={onOpen}>
          {many ? t('m.clip.choose') : t('m.clip.open')}
        </button>
      </div>
    </section>
  );
}
