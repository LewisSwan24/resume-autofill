// About this app: name, version and build from the phone, and one line on what the app is for. No links.
import { useEffect, useState } from 'react';
import { useMT } from '../i18n';
import { Sheet } from '../ui';

export type AppInfo = () => Promise<{ name: string; version: string; build: string }>;

export function AboutSheet({ open, onClose, appInfo }: { open: boolean; onClose: () => void; appInfo?: AppInfo }) {
  const t = useMT();
  return (
    <Sheet open={open} title={t('m.about.title')} onClose={onClose}>
      <AboutBody appInfo={appInfo} />
    </Sheet>
  );
}

function AboutBody({ appInfo }: { appInfo?: AppInfo }) {
  const t = useMT();
  const [info, setInfo] = useState<{ name: string; version: string; build: string } | 'failed' | null>(appInfo ? null : 'failed');

  useEffect(() => {
    if (!appInfo) return;
    let alive = true;
    appInfo()
      .then((next) => alive && setInfo(next))
      .catch(() => alive && setInfo('failed'));
    return () => {
      alive = false;
    };
  }, [appInfo]);

  const known = info !== null && info !== 'failed' ? info : null;
  return (
    <div className="m-sheet-stack">
      <p className="m-home-resume__title">{known?.name || t('m.about.name')}</p>
      {info === 'failed' ? (
        <p className="m-sheet-text m-row__caption">{t('m.about.versionUnknown')}</p>
      ) : known ? (
        <p className="m-sheet-text m-row__caption">{t('m.about.version', { version: known.version, build: known.build })}</p>
      ) : null}
      <p className="m-sheet-text">{t('m.about.tagline')}</p>
    </div>
  );
}
