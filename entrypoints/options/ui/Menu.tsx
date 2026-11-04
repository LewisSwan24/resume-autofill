// Action menu that opens from an icon button (DESIGN-SYSTEM Menu): role=menu / menuitem, arrow keys, Esc, click outside.
// Destructive items go last, after a separator.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react';
import { Icon, type IconName } from '../../../src/ui/Icon';
import { IconButton, cx } from './controls';

export interface MenuItem {
  id: string;
  label: string;
  icon: IconName;
  danger?: boolean;
  disabled?: boolean;
  onSelect: () => void;
}

interface Props {
  /** Accessible name of the trigger and the menu, e.g. "More actions for Resume 1". */
  label: string;
  items: readonly MenuItem[];
  className?: string;
}

export function Menu({ label, items, className }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  const close = (restoreFocus: boolean) => {
    setOpen(false);
    if (restoreFocus) trigger.current?.focus();
  };

  useEffect(() => {
    if (!open) return;
    const buttons = root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)');
    buttons?.[0]?.focus();
    const onPointerDown = (event: MouseEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [open]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.stopPropagation();
      close(true);
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End'];
    if (!keys.includes(event.key)) return;
    event.preventDefault();
    const buttons = [...(root.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [])];
    if (buttons.length === 0) return;
    const at = buttons.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1 : event.key === 'ArrowDown' ? (at + 1) % buttons.length : (at - 1 + buttons.length) % buttons.length;
    buttons[next]?.focus();
  };

  // A separator goes before the first destructive item (when something non-destructive comes before it).
  const firstDanger = items.findIndex((item) => item.danger);

  return (
    <div className={cx('raf-menu-wrap', className)} ref={root} onKeyDown={onKeyDown}>
      <IconButton
        ref={trigger}
        icon="three-dots"
        label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((v) => !v)}
      />
      {open ? (
        <div className="raf-menu" role="menu" id={menuId} aria-label={label}>
          {items.map((item, index) => (
            <div key={item.id} className="raf-menu__row" role="none">
              {index === firstDanger && index > 0 ? <div className="raf-menu__sep" role="separator" /> : null}
              <button
                type="button"
                role="menuitem"
                disabled={item.disabled}
                className={cx('raf-menu__item', item.danger && 'raf-menu__item--danger')}
                onClick={() => {
                  // Focus returns to the trigger first, so a Dialog opened by the item gives it back there.
                  close(true);
                  item.onSelect();
                }}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
