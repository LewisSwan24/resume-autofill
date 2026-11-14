// Privacy page (隐私说明), a sub-screen of Settings: six short sections, every sentence true of this build.
import { Icon, type IconName } from '../Icon';
import { useMT } from '../i18n';
import { IconButton } from '../ui';

const SECTIONS: ReadonlyArray<{ id: string; icon: IconName }> = [
  { id: 'where', icon: 'lock' },
  { id: 'upload', icon: 'shield' },
  { id: 'submit', icon: 'send-slash' },
  { id: 'fill', icon: 'input-cursor-text' },
  { id: 'export', icon: 'download' },
  { id: 'delete', icon: 'trash' },
];

export function PrivacyScreen({ onBack }: { onBack: () => void }) {
  const t = useMT();
  return (
    <>
      <header className="m-header m-header--module">
        <IconButton icon="arrow-left" label={t('m.back')} onClick={onBack} />
        <h1 className="m-title" tabIndex={-1}>
          {t('m.privacy.title')}
        </h1>
      </header>
      <div className="m-prose">
        {SECTIONS.map((s) => (
          <section key={s.id}>
            <h2>
              <Icon name={s.icon} />
              <span>{t(`m.privacy.${s.id}.title`)}</span>
            </h2>
            <p>{t(`m.privacy.${s.id}.body`)}</p>
          </section>
        ))}
      </div>
    </>
  );
}
