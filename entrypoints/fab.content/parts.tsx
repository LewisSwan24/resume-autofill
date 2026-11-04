// Small presentational pieces of the design system (Button, IconButton, Badge) written against the --raf-* tokens.
// They are plain markup + the classes in style.css; the closed shadow root cannot use bundle.css / bundle.js.
import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { Icon, type IconName } from '../../src/ui/Icon';
import { TONE_COLOR_VAR, type StatusTone } from '../../src/ui/status';

type ButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'type' | 'className'> & {
  /** `primary` = the single filled action of a view; default = outlined. */
  variant?: 'primary';
  block?: boolean;
  children: ReactNode;
};

/** Button (`li-btn`): 13/600 label, radius 12, 1px line; primary is accent-filled. */
export function Button({ variant, block, children, ...rest }: ButtonProps) {
  return (
    <button
      type="button"
      className={`raf-btn${variant === 'primary' ? ' raf-btn--primary' : ''}${block ? ' raf-btn--block' : ''}`}
      {...rest}
    >
      {children}
    </button>
  );
}

interface IconButtonProps {
  icon: IconName;
  /** Becomes both `aria-label` and the tooltip text (`data-tip`): same words, the design-system rule. */
  label: string;
  onClick: () => void;
  'aria-describedby'?: string;
}

/** IconButton (`li-icon-btn`) in its Popover size: 28px visual, hit area grown to 36px (44px on touch) in CSS. */
export function IconButton({ icon, label, onClick, 'aria-describedby': describedBy }: IconButtonProps) {
  return (
    <button type="button" className="raf-icon-btn" aria-label={label} data-tip={label} aria-describedby={describedBy} onClick={onClick}>
      <Icon name={icon} />
    </button>
  );
}

interface BadgeProps {
  icon: IconName;
  tone: StatusTone;
  /** One word (+ optional number) as a single string, so assistive tech reads "Filled 12". */
  text: string;
  testId?: string;
}

/** Outlined status Badge (`li-badge`): icon + word, tone colour on text and 1px border, never colour alone. */
export function Badge({ icon, tone, text, testId }: BadgeProps) {
  const style = { '--raf-badge-tone': TONE_COLOR_VAR[tone] } as CSSProperties;
  return (
    <span className="raf-badge" data-tone={tone} data-testid={testId} style={style}>
      <Icon name={icon} size={14} />
      <span className="raf-badge__text">{text}</span>
    </span>
  );
}
