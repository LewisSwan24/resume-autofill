// Privacy page (隐私说明), a sub-screen of Settings: six short sections, every sentence true of this build.
import { Icon, type IconName } from '../Icon';
import { useMT } from '../i18n';
import { IconButton } from '../ui';

/** Each section's paragraphs, in order. */
const SECTIONS: ReadonlyArray<{ id: string; icon: IconName; body: readonly string[] }> = [
  // Where things live: the resume (encrypted) and, since the fill browser, the sites' own sign-ins (the WebView's).
  { id: 'where', icon: 'lock', body: ['m.privacy.where.body', 'm.privacy.browser'] },
  { id: 'upload', icon: 'shield', body: ['m.privacy.upload.body'] },
  { id: 'submit', icon: 'send-slash', body: ['m.privacy.submit.body'] },
  { id: 'fill', icon: 'input-cursor-text', body: ['m.privacy.handOver'] },
  { id: 'export', icon: 'download', body: ['m.privacy.export.body'] },
  { id: 'delete', icon: 'trash', body: ['m.privacy.delete.body'] },
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
            {s.body.map((key) => (
              <p key={key}>{t(key)}</p>
            ))}
          </section>
        ))}
      </div>
    </>
  );
}
