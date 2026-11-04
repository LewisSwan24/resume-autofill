// Status filter: FilterChips (capsule, aria-pressed, tick when on, group icon, count in the text), grouped by tone
// (`STATUS_GROUPS`, the same vocabulary as the FAB card). One horizontally scrollable row, never wrapped.
// Nothing selected = show everything; only groups that occur are listed.
import { useT } from '../../src/i18n';
import { Icon } from '../../src/ui/Icon';
import { STATUS_GROUPS, TONE_COLOR_VAR, type StatusGroupId } from '../../src/ui/status';
import { GROUP_ORDER } from './model';

interface Props {
  counts: Record<StatusGroupId, number>;
  total: number;
  selected: ReadonlySet<StatusGroupId>;
  onToggle: (group: StatusGroupId) => void;
  onClear: () => void;
}

function Tick() {
  return (
    <span className="raf-chip-tick">
      <Icon name="check-lg" size={14} />
    </span>
  );
}

export function FilterChips({ counts, total, selected, onToggle, onClear }: Props) {
  const t = useT();
  return (
    <div className="raf-chips raf-chips-scroll" role="group" aria-label={t('panel.filter.label')}>
      <button type="button" className="raf-chip" aria-pressed={selected.size === 0} onClick={onClear}>
        <Tick />
        <span className="raf-chip-text">
          {t('panel.filter.all')} <span className="raf-chip-count">{total}</span>
        </span>
      </button>
      {GROUP_ORDER.filter((g) => counts[g] > 0 || selected.has(g)).map((group) => {
        const status = STATUS_GROUPS[group];
        return (
          <button key={group} type="button" className="raf-chip" data-group={group} aria-pressed={selected.has(group)} onClick={() => onToggle(group)}>
            <Tick />
            <span className="raf-status-icon" style={{ color: TONE_COLOR_VAR[status.tone] }}>
              <Icon name={status.icon} size={14} />
            </span>
            <span className="raf-chip-text">
              {t(status.labelKey)} <span className="raf-chip-count">{counts[group]}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
