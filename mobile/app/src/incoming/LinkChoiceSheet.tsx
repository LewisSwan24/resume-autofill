// 「打开哪个链接？」: shared or copied text held several links. One row per link (host in bold, the title
// when found, the rest of the URL in small text clipped to two lines; the full URL is the row's description).
import { useId } from 'react';
import { useMT } from '../i18n';
import { recentKey } from '../store/recentPages';
import { Sheet } from '../ui';
import type { FoundLink } from './route';

export interface LinkChoiceSheetProps {
  open: boolean;
  links: readonly FoundLink[];
  /** Links found but not listed. */
  more: number;
  /** Words of the lead line: a share or a copy. */
  source: 'share' | 'clipboard';
  /** recordKeys of links already in the tracker. */
  knownKeys: ReadonlySet<string>;
  onPick: (link: FoundLink) => void;
  onClose: () => void;
}

/** The URL after its scheme and host, which the row already shows in bold. */
function urlRest(url: string): string {
  try {
    const u = new URL(url);
    const rest = `${u.port ? `:${u.port}` : ''}${u.pathname}${u.search}${u.hash}`;
    return rest === '/' ? '' : rest;
  } catch {
    return url;
  }
}

export function LinkChoiceSheet({ open, links, more, source, knownKeys, onPick, onClose }: LinkChoiceSheetProps) {
  const t = useMT();
  const id = useId();
  const total = links.length + more;
  return (
    <Sheet open={open} title={t('m.in.chooseTitle')} onClose={onClose}>
      <div className="m-sheet-stack">
        <p className="m-sheet-text">{source === 'clipboard' ? t('m.clip.many', { n: total }) : t('m.in.chooseText', { n: total })}</p>
        <ul className="m-link-choices">
          {links.map((link, i) => {
            const urlId = `${id}-url-${i}`;
            const actionId = `${id}-action-${i}`;
            const titleId = `${id}-title-${i}`;
            const knownId = `${id}-known-${i}`;
            const rest = urlRest(link.url);
            const known = knownKeys.has(recentKey(link.url));
            // The name is 打开 {host}, then the title and the 已在网申记录里 tag as shown, so two links on one host differ
            // for TalkBack too; the full URL is the description.
            const labelledBy = [actionId, link.title ? titleId : null, known ? knownId : null].filter(Boolean).join(' ');
            return (
              <li key={link.url}>
                <button type="button" className="m-link-choice" aria-labelledby={labelledBy} aria-describedby={urlId} onClick={() => onPick(link)}>
                  <span id={actionId} className="m-visually-hidden">
                    {t('m.in.openLink', { host: link.host })}
                  </span>
                  <span className="m-link-choice__host" aria-hidden="true">
                    {link.host}
                  </span>
                  {link.title ? (
                    <span id={titleId} className="m-link-choice__title">
                      {link.title}
                    </span>
                  ) : null}
                  {rest ? <span className="m-link-choice__url" aria-hidden="true">{rest}</span> : null}
                  <span id={urlId} className="m-visually-hidden">
                    {link.url}
                  </span>
                  {known ? (
                    <span id={knownId} className="m-tag">
                      {t('m.in.known')}
                    </span>
                  ) : null}
                </button>
              </li>
            );
          })}
        </ul>
        {more > 0 ? <p className="m-help">{t('m.in.chooseMore', { n: more })}</p> : null}
        <button type="button" className="m-button m-button--wide" onClick={onClose}>
          {t('common.cancel')}
        </button>
      </div>
    </Sheet>
  );
}
