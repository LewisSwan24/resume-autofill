// What became of each entry of the repeated sections in the last fill: one row per entry, by section, before the
// rows of fields. Each row has the entry's name from the resume, its number, its state and its fields by outcome;
// a skipped entry says why. Words are shared with the FAB card (src/ui/entryText.ts).
import type { EntryProgress, FieldReport } from '../../src/engine/types';
import { useT } from '../../src/i18n';
import { countEntries, entryCountsText, entryReasonText, entryStatus, sectionLabelKey } from '../../src/ui/entryText';
import { Icon } from '../../src/ui/Icon';
import { TONE_COLOR_VAR } from '../../src/ui/status';

export function EntryOverview({ entries, fields }: { entries: readonly EntryProgress[]; fields: readonly FieldReport[] }) {
  const t = useT();
  const counted = countEntries(entries, fields);
  const sections = [...new Set(counted.map((e) => e.section))];
  const added = counted.filter((e) => e.state === 'added').length;
  const skipped = counted.filter((e) => e.state === 'skipped').length;
  return (
    <div className="raf-entry-overview" data-testid="raf-entry-overview">
      <div className="raf-entry-overview-head">
        <h2 className="raf-entry-overview-title">{t('panel.entries.title')}</h2>
        <span className="raf-help">{t('panel.entries.summary', { added, skipped })}</span>
      </div>
      {sections.map((section) => {
        const list = counted.filter((e) => e.section === section);
        const placed = list.filter((e) => e.state !== 'skipped').length;
        return (
          <div key={section} className="raf-entry-group">
            <div className="raf-entry-sec">
              <span className="raf-entry-sec-name">{t(sectionLabelKey(section))}</span>
              <span className="raf-help">{t('fab.entries.count', { n: placed, total: list.length })}</span>
            </div>
            {list.map((e) => {
              const status = entryStatus(e);
              const number = t('common.entry.number', { n: e.index + 1 });
              const state = t(`common.entry.state.${e.state}`);
              const why =
                e.state === 'existing' || e.state === 'added'
                  ? `${number} · ${state} · ${entryCountsText(t, e)}`
                  : `${number} · ${state}`;
              return (
                <div key={e.index} className="raf-entry" data-testid="raf-entry" data-state={e.state}>
                  <span className="raf-entry-no">{e.index + 1}</span>
                  <span className="raf-entry-main">
                    <span className="raf-entry-title">{e.label || number}</span>
                    <span className="raf-entry-why">{why}</span>
                    {e.state === 'skipped' ? (
                      <span className="raf-entry-reason">
                        <span style={{ color: TONE_COLOR_VAR.danger }}>
                          <Icon name="x-circle" size={14} />
                        </span>
                        <span>{entryReasonText(t, e)}</span>
                      </span>
                    ) : e.state === 'held' ? (
                      <span className="raf-entry-reason">{t('common.entry.heldWhy')}</span>
                    ) : null}
                  </span>
                  <span
                    className="raf-badge"
                    data-tone={status.tone}
                    style={{ color: TONE_COLOR_VAR[status.tone], borderColor: TONE_COLOR_VAR[status.tone] }}
                  >
                    <Icon name={status.icon} size={14} />
                    {t(status.labelKey)}
                  </span>
                </div>
              );
            })}
          </div>
        );
      })}
    </div>
  );
}
