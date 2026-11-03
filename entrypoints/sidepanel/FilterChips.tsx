// Outcome filter chips with counts. Nothing selected = show everything.
import type { Outcome } from '../../src/engine/types';
import { useT } from '../../src/i18n';
import { OUTCOME_ORDER, outcomeTone } from './model';

interface Props {
  counts: Record<Outcome, number>;
  selected: ReadonlySet<Outcome>;
  onToggle: (outcome: Outcome) => void;
  onClear: () => void;
}

export function FilterChips({ counts, selected, onToggle, onClear }: Props) {
  const t = useT();
  return (
    <div className="raf-filters" role="group" aria-label={t('panel.filter.label')}>
      <button type="button" className="raf-filter" aria-pressed={selected.size === 0} onClick={onClear}>
        {t('panel.filter.all')}
      </button>
      {OUTCOME_ORDER.filter((o) => counts[o] > 0 || selected.has(o)).map((outcome) => (
        <button
          key={outcome}
          type="button"
          className={`raf-filter raf-filter-${outcomeTone(outcome)}`}
          aria-pressed={selected.has(outcome)}
          onClick={() => onToggle(outcome)}
        >
          {t(`panel.outcome.${outcome}`)}
          <span className="raf-count">{counts[outcome]}</span>
        </button>
      ))}
    </div>
  );
}
