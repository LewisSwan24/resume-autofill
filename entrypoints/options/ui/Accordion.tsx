// Accordion (DESIGN-SYSTEM Accordion): sections inside ONE bordered surface, separated by 1px lines.
// The body is only mounted while open, so labels stay unique on the page and closed sections cost nothing.
import { useId, type ReactNode } from 'react';
import { Icon } from '../../../src/ui/Icon';
import { Badge } from './controls';

export function Accordion({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={className ? `raf-accordion ${className}` : 'raf-accordion'}>{children}</div>;
}

interface ItemProps {
  title: string;
  /** Number of entries (repeatable modules); hidden when 0. */
  count?: number;
  open: boolean;
  onToggle: (open: boolean) => void;
  children: ReactNode;
}

export function AccordionItem({ title, count = 0, open, onToggle, children }: ItemProps) {
  const id = useId();
  const headId = `${id}-head`;
  const bodyId = `${id}-body`;
  return (
    <section className="raf-accordion__item" data-open={open || undefined}>
      <h3 className="raf-accordion__title">
        <button type="button" id={headId} className="raf-accordion__head" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => onToggle(!open)}>
          <span className="raf-accordion__name">{title}</span>
          {count > 0 ? <Badge>{count}</Badge> : null}
          <Icon name="chevron-down" className="raf-accordion__chevron" />
        </button>
      </h3>
      {open ? (
        <div id={bodyId} role="region" aria-labelledby={headId} className="raf-accordion__body">
          {children}
        </div>
      ) : null}
    </section>
  );
}
