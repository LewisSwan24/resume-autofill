// Page-level view switch (DESIGN-SYSTEM Tabs): icon + one word; the word shows only on the selected tab,
// the others keep it as accessible name and tooltip. Roving tabindex, arrow keys, Home / End.
import { useRef, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '../../../src/ui/Icon';

export interface TabItem<Id extends string> {
  id: Id;
  label: string;
  icon: IconName;
}

interface Props<Id extends string> {
  tabs: ReadonlyArray<TabItem<Id>>;
  value: Id;
  onChange: (id: Id) => void;
  ariaLabel: string;
  /** Prefix for the ids linking tabs and panels, see `tabId` / `panelId`. */
  idPrefix: string;
}

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

export function Tabs<Id extends string>({ tabs, value, onChange, ariaLabel, idPrefix }: Props<Id>) {
  const refs = useRef(new Map<Id, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    let next = -1;
    if (event.key === 'ArrowRight') next = index === last ? 0 : index + 1;
    else if (event.key === 'ArrowLeft') next = index === 0 ? last : index - 1;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = last;
    if (next < 0) return;
    event.preventDefault();
    const target = tabs[next]!;
    onChange(target.id);
    refs.current.get(target.id)?.focus();
  };

  return (
    <div className="raf-tabs" role="tablist" aria-label={ariaLabel}>
      {tabs.map((tab, index) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) refs.current.set(tab.id, el);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.id)}
            className="raf-tab"
            aria-selected={selected}
            aria-controls={panelId(idPrefix, tab.id)}
            aria-label={tab.label}
            data-tip={tab.label}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            onKeyDown={(e) => onKeyDown(e, index)}
          >
            <Icon name={tab.icon} />
            <span className="raf-tab__label" aria-hidden="true">
              <span>{tab.label}</span>
            </span>
          </button>
        );
      })}
    </div>
  );
}
