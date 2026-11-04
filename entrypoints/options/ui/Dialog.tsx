// Modal question (DESIGN-SYSTEM Dialog): native <dialog> shown with showModal(), a question as title, one sentence of
// consequence, two buttons. The safe button gets focus first; Esc and "Not now" both close; focus goes back afterwards.
import { useEffect, useId, useRef, type ReactNode } from 'react';
import { Button } from './controls';

interface Props {
  title: string;
  /** One or two sentences: what happens next. */
  text: ReactNode;
  /** Extra content between the text and the buttons (e.g. a select). */
  children?: ReactNode;
  /** Label of the safe button, e.g. "Not now". */
  cancelLabel: string;
  /** Label of the committing button, e.g. "Delete resume". */
  confirmLabel: string;
  danger?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}

/** Mount it while the question is open: `{target ? <Dialog … /> : null}`. */
export function Dialog({ title, text, children, cancelLabel, confirmLabel, danger, onCancel, onConfirm }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const safe = useRef<HTMLButtonElement>(null);
  const id = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    const before = document.activeElement as HTMLElement | null;
    // jsdom (unit tests) has no showModal; a plain `open` attribute is enough there.
    if (typeof dialog.showModal === 'function' && !dialog.open) dialog.showModal();
    else dialog.setAttribute('open', '');
    safe.current?.focus();
    return () => {
      if (typeof dialog.close === 'function' && dialog.open) dialog.close();
      if (before && before.isConnected) before.focus();
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className="raf-dialog"
      aria-labelledby={`${id}-title`}
      aria-describedby={`${id}-text`}
      onCancel={(event) => {
        event.preventDefault();
        onCancel();
      }}
    >
      <h2 id={`${id}-title`} className="raf-dialog__title">
        {title}
      </h2>
      <p id={`${id}-text`} className="raf-dialog__text">
        {text}
      </p>
      {children}
      <div className="raf-dialog__actions">
        <Button ref={safe} onClick={onCancel}>
          {cancelLabel}
        </Button>
        <Button variant={danger ? 'danger' : 'primary'} onClick={onConfirm}>
          {confirmLabel}
        </Button>
      </div>
    </dialog>
  );
}
