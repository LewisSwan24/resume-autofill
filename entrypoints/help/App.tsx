// Help page (使用说明): how filling works, what each side-panel status means, supported sites, privacy, common problems.
// Opened from the side panel toolbar, the options page header and the welcome page. Statuses are drawn from the same
// table as the side panel (src/ui/status.ts), so a new outcome cannot be missing here without a type error.
import { useEffect, type ReactNode } from 'react';
import type { Outcome } from '../../src/engine/types';
import { useT, type MessageKey } from '../../src/i18n';
import { Icon } from '../../src/ui/Icon';
import { LanguageToggle } from '../../src/ui/LanguageToggle';
import { openProfilePage } from '../../src/ui/pages';
import { OUTCOME_STATUS, TONE_COLOR_VAR } from '../../src/ui/status';
import { usePageLanguage } from '../../src/ui/usePageLanguage';
import { Button } from '../options/ui/controls';
import '../../src/ui/fonts.css';
import '../../src/ui/theme.css';
import '../options/ui/ui.css';
import '../../src/ui/docPage.css';

const SECTIONS = [
  { id: 'how', title: 'help.how.title' },
  { id: 'statuses', title: 'help.status.title' },
  { id: 'sites', title: 'help.sites.title' },
  { id: 'privacy', title: 'help.privacy.title' },
  { id: 'faq', title: 'help.faq.title' },
] as const satisfies ReadonlyArray<{ id: string; title: MessageKey }>;
type SectionId = (typeof SECTIONS)[number]['id'];

/** What each status means and what to do about it; keyed by outcome so every outcome has one. */
const STATUS_TEXT: Record<Outcome, MessageKey> = {
  filled: 'help.status.filled',
  needs_review: 'help.status.needs_review',
  no_option: 'help.status.no_option',
  unmatched: 'help.status.unmatched',
  action_failed: 'help.status.action_failed',
  no_data: 'help.status.no_data',
  no_control: 'help.status.no_control',
};

const FAQ = ['button', 'missed', 'wrong', 'file', 'stale', 'language'] as const;

function Section({ id, children }: { id: SectionId; children: ReactNode }) {
  const t = useT();
  const title = SECTIONS.find((s) => s.id === id)!.title;
  return (
    <section id={id} className="raf-doc-card" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="raf-doc-h2">
        {t(title)}
      </h2>
      {children}
    </section>
  );
}

export default function App() {
  const t = useT();
  const { ready, change } = usePageLanguage();

  useEffect(() => {
    document.title = t('help.pageTitle');
  }, [t]);

  if (!ready) return null;

  return (
    <div className="raf-doc">
      <header className="raf-doc-header">
        <div className="raf-doc-header__text">
          <h1 className="raf-doc-title">{t('help.title')}</h1>
          <p className="raf-doc-lead">{t('help.lead')}</p>
        </div>
        <div className="raf-doc-header__end">
          <Button icon="person-vcard" onClick={openProfilePage}>
            {t('common.editProfile')}
          </Button>
          <LanguageToggle onChange={change} />
        </div>
      </header>

      <main className="raf-doc-main">
        <nav className="raf-toc" aria-label={t('help.contents')}>
          <ol>
            {SECTIONS.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{t(s.title)}</a>
              </li>
            ))}
          </ol>
        </nav>

        <Section id="how">
          <p>{t('help.how.p1')}</p>
          <p>{t('help.how.p2')}</p>
          <p>{t('help.how.p3')}</p>
          <p>{t('help.how.p4')}</p>
        </Section>

        <Section id="statuses">
          <p className="raf-doc-muted">{t('help.status.lead')}</p>
          <ul className="raf-status-list">
            {(Object.keys(OUTCOME_STATUS) as Outcome[]).map((outcome) => {
              const status = OUTCOME_STATUS[outcome];
              return (
                <li key={outcome} data-outcome={outcome}>
                  <span className="raf-doc-badge" style={{ color: TONE_COLOR_VAR[status.tone] }}>
                    <Icon name={status.icon} size={14} />
                    <span>{t(status.labelKey)}</span>
                  </span>
                  <p>{t(STATUS_TEXT[outcome])}</p>
                </li>
              );
            })}
          </ul>
        </Section>

        <Section id="sites">
          <p>{t('help.sites.lead')}</p>
          <ul className="raf-doc-list">
            <li>{t('help.sites.moka')}</li>
            <li>{t('help.sites.beisen')}</li>
            <li>{t('help.sites.feishu')}</li>
          </ul>
          <p>{t('help.sites.generic')}</p>
          <p className="raf-doc-muted">{t('help.sites.unknown')}</p>
        </Section>

        <Section id="privacy">
          <p>{t('help.privacy.local')}</p>
          <p>{t('help.privacy.noSubmit')}</p>
          <p className="raf-doc-muted">{t('help.privacy.backup')}</p>
        </Section>

        <Section id="faq">
          <div className="raf-faq">
            {FAQ.map((key) => (
              <div key={key}>
                <h3 className="raf-doc-h3">{t((`help.faq.${key}.q` as const) satisfies MessageKey)}</h3>
                <p>{t((`help.faq.${key}.a` as const) satisfies MessageKey)}</p>
              </div>
            ))}
          </div>
        </Section>
      </main>
    </div>
  );
}
