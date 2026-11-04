// File drop zone (DESIGN-SYSTEM FileUpload): dashed box, upload icon, one line of title, the limits spelled out BEFORE
// choosing. A transparent <input type=file> covers the whole box, so click, keyboard and dropping a file all go through it.
import { useState } from 'react';
import { Icon } from '../../../src/ui/Icon';
import { cx } from './controls';

interface Props {
  id: string;
  title: string;
  /** Limits in words: accepted types and size. */
  help: string;
  /** File-picker filter (`accept` attribute). */
  accept: string;
  /** Accessible name of the file input (must be unique on the page). */
  label: string;
  error?: string | null;
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function FileUpload({ id, title, help, accept, label, error, onFile, disabled }: Props) {
  const [over, setOver] = useState(false);
  const helpId = `${id}-help`;
  const errorId = `${id}-error`;
  return (
    <div className="raf-upload-field">
      <div
        className={cx('raf-upload', over && 'is-over')}
        onDragEnter={() => setOver(true)}
        onDragLeave={() => setOver(false)}
        onDrop={() => setOver(false)}
      >
        <Icon name="upload" size={24} />
        <span className="raf-upload__title">{title}</span>
        <span id={helpId} className="raf-upload__help">
          {help}
        </span>
        <input
          id={id}
          type="file"
          accept={accept}
          disabled={disabled}
          aria-label={label}
          aria-describedby={error ? `${helpId} ${errorId}` : helpId}
          aria-invalid={error ? true : undefined}
          onChange={(event) => {
            const file = event.target.files?.[0];
            event.target.value = '';
            if (file) onFile(file);
          }}
        />
      </div>
      {error ? (
        <p id={errorId} className="raf-field__help raf-field__help--error">
          {error}
        </p>
      ) : null}
    </div>
  );
}
