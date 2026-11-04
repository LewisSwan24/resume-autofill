// Small design-system primitives for the options page (DESIGN-SYSTEM §3). Class names are `raf-*` and styled in ./ui.css
// from the shared `--raf-*` tokens; behaviour (state, keyboard) lives here, not in a script. Options page only.
import { useId, type ComponentProps, type CSSProperties, type ReactNode } from 'react';
import { Icon, type IconName } from '../../../src/ui/Icon';

export const cx = (...parts: Array<string | false | null | undefined>): string => parts.filter(Boolean).join(' ');

// ------------------------------------------------------------------ actions

export interface ButtonProps extends ComponentProps<'button'> {
  /** `primary`: at most one per view. `danger`: only the last step of a destructive action. */
  variant?: 'default' | 'primary' | 'danger';
  icon?: IconName;
}

export function Button({ variant = 'default', icon, className, children, type = 'button', ...rest }: ButtonProps) {
  return (
    <button type={type} {...rest} className={cx('raf-btn', variant !== 'default' && `raf-btn--${variant}`, className)}>
      {icon ? <Icon name={icon} /> : null}
      {children}
    </button>
  );
}

export interface IconButtonProps extends Omit<ComponentProps<'button'>, 'children' | 'aria-label'> {
  icon: IconName;
  /** Both the accessible name and the tooltip (they must say the same thing). */
  label: string;
  /** Tooltip text when it should say more than the name, e.g. why the button is disabled. */
  tip?: string;
  danger?: boolean;
}

export function IconButton({ icon, label, tip, danger, className, type = 'button', ...rest }: IconButtonProps) {
  return (
    <button type={type} {...rest} aria-label={label} data-tip={tip ?? label} className={cx('raf-icon-btn', danger && 'raf-icon-btn--danger', className)}>
      <Icon name={icon} />
    </button>
  );
}

// ------------------------------------------------------------------ content

/** Outlined one-word label. Never a button. */
export function Badge({ children, tone = 'default', className }: { children: ReactNode; tone?: 'default' | 'danger'; className?: string }) {
  return <span className={cx('raf-badge', tone === 'danger' && 'raf-badge--danger', className)}>{children}</span>;
}

export function Divider() {
  return <hr className="raf-divider" />;
}

interface NoticeProps {
  tone?: 'info' | 'danger';
  icon?: IconName;
  title?: string;
  children: ReactNode;
  /** A single action (Button) shown after the text. */
  action?: ReactNode;
  className?: string;
}

/** A tile in the page flow. `danger` has a danger border and announces itself (`role="alert"`). */
export function Notice({ tone = 'info', icon, title, children, action, className }: NoticeProps) {
  const danger = tone === 'danger';
  return (
    <div className={cx('raf-notice', danger && 'raf-notice--danger', className)} {...(danger ? { role: 'alert' } : {})}>
      <Icon name={icon ?? (danger ? 'exclamation-triangle' : 'info-circle')} />
      <p className="raf-notice__text">
        {title ? <strong className="raf-notice__title">{title}</strong> : null}
        {children}
      </p>
      {action}
    </div>
  );
}

export function EmptyState({ icon = 'file-earmark-text', children, action }: { icon?: IconName; children: ReactNode; action?: ReactNode }) {
  return (
    <div className="raf-empty">
      <span className="raf-empty__tile">
        <Icon name={icon} />
      </span>
      <p className="raf-empty__text">{children}</p>
      {action}
    </div>
  );
}

interface ListItemProps {
  icon: IconName;
  title: ReactNode;
  meta?: ReactNode;
  /** Makes the tile + text one button (selects the row). */
  onClick?: () => void;
  current?: boolean;
  /** Outlined Badge shown after the name (e.g. Active). */
  badge?: ReactNode;
  /** Trailing content: at most one action. */
  children?: ReactNode;
  className?: string;
}

/** One row: 36px icon tile, name, meta line, at most one trailing action (DESIGN-SYSTEM ListItem). */
export function ListItem({ icon, title, meta, onClick, current, badge, children, className }: ListItemProps) {
  const body = (
    <>
      <span className="raf-list-item__tile">
        <Icon name={icon} />
      </span>
      <span className="raf-list-item__text">
        <span className="raf-list-item__head">
          <span className="raf-list-item__name" title={typeof title === 'string' ? title : undefined}>{title}</span>
          {badge}
        </span>
        {meta ? <span className="raf-list-item__meta">{meta}</span> : null}
      </span>
    </>
  );
  return (
    <div className={cx('raf-list-item', onClick && 'raf-list-item--button', current && 'is-current', className)}>
      {onClick ? (
        <button type="button" className="raf-list-item__main" aria-current={current ? 'true' : undefined} onClick={onClick}>
          {body}
        </button>
      ) : (
        <div className="raf-list-item__main">{body}</div>
      )}
      {children}
    </div>
  );
}

/** Slim determinate / indeterminate bar. Put the number next to it when it is determinate. */
export function Progress({ label, value }: { label: string; value?: number }) {
  const busy = value === undefined;
  return (
    <div
      className={cx('raf-progress', busy && 'raf-progress--busy')}
      role="progressbar"
      aria-label={label}
      aria-busy={busy || undefined}
      {...(busy ? {} : { 'aria-valuemin': 0, 'aria-valuemax': 100, 'aria-valuenow': value })}
    >
      <span className="raf-progress__bar" style={busy ? undefined : { width: `${value}%` }} />
    </div>
  );
}

// ------------------------------------------------------------------ form controls

export function Input({ className, ...rest }: ComponentProps<'input'>) {
  return <input {...rest} className={cx('raf-input', className)} />;
}

export function Textarea({ className, ...rest }: ComponentProps<'textarea'>) {
  return <textarea {...rest} className={cx('raf-input', 'raf-textarea', className)} />;
}

/** Native select in the design system's look; the native list keeps keyboard, touch and screen readers right. */
export function SelectInput({ className, children, ...rest }: ComponentProps<'select'>) {
  return (
    <span className="raf-select">
      <select {...rest} className={cx('raf-input', className)}>
        {children}
      </select>
      <Icon name="chevron-down" className="raf-select__chevron" />
    </span>
  );
}

export interface ControlProps {
  id: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
}

interface FieldProps {
  label: string;
  /** Message under the control; also marks it `aria-invalid`. */
  error?: string | null;
  help?: string;
  className?: string;
  children: (control: ControlProps) => ReactNode;
}

/** Visible top label + control + optional help / error text, wired together with ids. */
export function Field({ label, error, help, className, children }: FieldProps) {
  const id = useId();
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  const describedBy = [error ? errorId : null, help ? helpId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('raf-field', className)}>
      <label className="raf-field__label" htmlFor={id}>
        {label}
      </label>
      {children({ id, ...(error ? { 'aria-invalid': true as const } : {}), 'aria-describedby': describedBy })}
      {help ? (
        <p id={helpId} className="raf-field__help">
          {help}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="raf-field__help raf-field__help--error">
          {error}
        </p>
      ) : null}
    </div>
  );
}

interface ChoiceProps extends Omit<ComponentProps<'input'>, 'type' | 'onChange' | 'checked'> {
  label: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  help?: string;
}

/** Checkbox for a choice that is confirmed later (or a modifier such as "Present"). */
export function Checkbox({ label, checked, onChange, className, ...rest }: ChoiceProps) {
  return (
    <label className={cx('raf-choice', className)}>
      <input {...rest} type="checkbox" className="raf-checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      <span>{label}</span>
    </label>
  );
}

/** Switch for a setting that applies (and autosaves) the moment it is flipped. The label names the setting, not the state. */
export function Switch({ label, checked, onChange, help, className, ...rest }: ChoiceProps) {
  const id = useId();
  return (
    <div className={cx('raf-switch-row', className)}>
      <label className="raf-choice">
        <input
          {...rest}
          type="checkbox"
          role="switch"
          className="raf-switch"
          checked={checked}
          aria-describedby={help ? `${id}-help` : rest['aria-describedby']}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>{label}</span>
      </label>
      {help ? (
        <p id={`${id}-help`} className="raf-field__help">
          {help}
        </p>
      ) : null}
    </div>
  );
}

interface SegmentedProps<V extends string> {
  /** Accessible name of the radio group. */
  label: string;
  /** Show the label above the control (default: only for assistive tech). */
  visibleLabel?: boolean;
  value: V;
  options: ReadonlyArray<{ value: V; label: string }>;
  onChange: (value: V) => void;
  className?: string;
}

/** 2–5 short, equal-width options; one is always on. Native radios underneath. */
export function Segmented<V extends string>({ label, visibleLabel, value, options, onChange, className }: SegmentedProps<V>) {
  const name = useId();
  const labelId = `${name}-label`;
  const index = Math.max(
    0,
    options.findIndex((o) => o.value === value),
  );
  const style = { '--seg-n': options.length, '--seg-i': index } as CSSProperties;
  return (
    <div className={cx('raf-segmented-wrap', className)}>
      <span id={labelId} className={visibleLabel ? 'raf-field__label' : 'raf-visually-hidden'}>
        {label}
      </span>
      <div className="raf-segmented" role="radiogroup" aria-labelledby={labelId} style={style}>
        {options.map((option) => (
          <label key={option.value} className="raf-segmented__item">
            <input type="radio" name={name} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} />
            {option.label}
          </label>
        ))}
      </div>
    </div>
  );
}
