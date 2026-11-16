// Which resume this page is filled with. One row per resume with its language and how much is filled; on the
// sample form only, the made-up sample resume first. The choice lasts for this page; choosing closes the sheet.
import type { Profile } from '../../../../src/schema';
import { summarizeResume } from '../home/summary';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { DockedSheet } from './DockedSheet';

export type ResumePick = { kind: 'sample' } | { kind: 'profile'; resumeId: string };

export interface ResumeChoiceSheetProps {
  open: boolean;
  profile: Profile | null;
  /** The sample form: the sample resume is offered (and only there). */
  demo: boolean;
  /** The resume a fill would use now. */
  current: ResumePick | null;
  onChoose: (pick: ResumePick) => void;
  onClose: () => void;
}

export function ResumeChoiceSheet({ open, profile, demo, current, onChoose, onClose }: ResumeChoiceSheetProps) {
  const t = useMT();
  const isOn = (pick: ResumePick) =>
    current !== null && current.kind === pick.kind && (pick.kind === 'sample' || (current.kind === 'profile' && current.resumeId === pick.resumeId));
  const row = (pick: ResumePick, key: string, name: string, caption: string, tag: string | null) => {
    const on = isOn(pick);
    return (
      <button
        key={key}
        type="button"
        role="radio"
        aria-checked={on}
        className={on ? 'm-choice m-choice--on' : 'm-choice'}
        onClick={() => {
          onChoose(pick);
          onClose();
        }}
      >
        <span className="m-choice__text">
          <span className="m-row__name">
            {name}
            {tag ? <span className="m-tag">{tag}</span> : null}
          </span>
          <span className="m-row__caption">{caption}</span>
        </span>
        {on ? <Icon name="check-lg" /> : null}
      </button>
    );
  };
  return (
    <DockedSheet open={open} title={t('m.br.resume.title')} modal onClose={onClose}>
      <div className="m-sheet-stack">
        <div className="m-choices" role="radiogroup" aria-label={t('m.br.resume.title')}>
          {demo ? row({ kind: 'sample' }, 'sample', t('m.br.resume.sample'), t('m.br.resume.sampleHint'), null) : null}
          {(profile?.resumes ?? []).map((r) =>
            row(
              { kind: 'profile', resumeId: r.id },
              r.id,
              r.title || t(r.locale.startsWith('zh') ? 'm.defaultTitle.zh' : 'm.defaultTitle.en'),
              t('m.filled', { n: summarizeResume(r).filledCount }),
              t(r.locale.startsWith('zh') ? 'm.zhTag' : 'm.enTag'),
            ),
          )}
        </div>
        <p className="m-help">{t('m.br.resume.hint')}</p>
      </div>
    </DockedSheet>
  );
}
