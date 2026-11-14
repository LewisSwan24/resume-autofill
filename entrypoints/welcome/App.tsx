// Welcome page: opened once by the background on a fresh install (src/background/index.ts). What the extension does,
// the three steps, and that it never submits. Its one primary action is the profile page.
import { useEffect } from 'react';
import { useT, type MessageKey } from '../../src/i18n';
import { LanguageToggle } from '../../src/ui/LanguageToggle';
import { HELP_PAGE, openExtensionPage, openProfilePage } from '../../src/ui/pages';
import { usePageLanguage } from '../../src/ui/usePageLanguage';
import { Button, Notice } from '../options/ui/controls';
import '../../src/ui/fonts.css';
import '../../src/ui/theme.css';
import '../options/ui/ui.css';
import '../../src/ui/docPage.css';

const STEPS: ReadonlyArray<{ title: MessageKey; text: MessageKey }> = [
  { title: 'welcome.step1.title', text: 'welcome.step1.text' },
  { title: 'welcome.step2.title', text: 'welcome.step2.text' },
  { title: 'welcome.step3.title', text: 'welcome.step3.text' },
];

export default function App() {
  const t = useT();
  const { ready, change } = usePageLanguage();

  useEffect(() => {
    document.title = t('welcome.pageTitle');
  }, [t]);

  // Nothing until the stored language is known, so a Chinese page never flashes English first.
  if (!ready) return null;

  return (
    <div className="raf-doc">
      <header className="raf-doc-header">
        <div className="raf-doc-header__text">
          <h1 className="raf-doc-title">{t('welcome.title')}</h1>
          <p className="raf-doc-lead">{t('welcome.lead')}</p>
        </div>
        <div className="raf-doc-header__end">
          <LanguageToggle onChange={change} />
        </div>
      </header>

      <main className="raf-doc-main">
        <section className="raf-doc-section" aria-labelledby="raf-welcome-steps">
          <h2 id="raf-welcome-steps" className="raf-doc-h2">
            {t('welcome.steps')}
          </h2>
          <ol className="raf-steps" aria-labelledby="raf-welcome-steps">
            {STEPS.map((step, i) => (
              <li key={step.title} className="raf-step">
                <span className="raf-step__number" aria-hidden="true">
                  {i + 1}
                </span>
                <h3 className="raf-doc-h3">{t(step.title)}</h3>
                <p>{t(step.text)}</p>
              </li>
            ))}
          </ol>
        </section>

        <Notice title={t('welcome.noSubmit.title')}>
          {t('welcome.noSubmit.text')}
        </Notice>
        <p className="raf-doc-muted">
          {t('welcome.privacy')}
        </p>

        <div className="raf-doc-actions">
          <Button variant="primary" icon="person-vcard" onClick={openProfilePage}>
            {t('common.fillProfile')}
          </Button>
          <Button icon="book" onClick={() => openExtensionPage(HELP_PAGE)}>
            {t('common.help')}
          </Button>
        </div>
      </main>
    </div>
  );
}
