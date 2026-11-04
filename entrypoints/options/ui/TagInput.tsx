// Tag input (DESIGN-SYSTEM TagInput): collects short words as tiles. Enter or a comma adds the word, Backspace on an
// empty box or the tile's own button removes one. Enter / commas typed while an IME is composing (e.g. picking a Chinese
// word with Enter) never add anything - that is what the `isComposing` / keyCode 229 checks are for.
import { useRef, useState, type ChangeEvent, type ClipboardEvent, type KeyboardEvent } from 'react';
import { useT } from '../../../src/i18n';
import { Icon } from '../../../src/ui/Icon';
import { cx } from './controls';

interface Props {
  id?: string;
  value: readonly string[];
  onChange: (value: string[]) => void;
  placeholder?: string;
  'aria-invalid'?: true;
  'aria-describedby'?: string;
  /** Used when no visible `<label htmlFor>` points at the input. */
  'aria-label'?: string;
  disabled?: boolean;
}

/** Characters that end a word: ASCII and full-width commas, the Chinese enumeration comma, semicolons, line breaks. */
const SEPARATOR = /[,，、;；\n]/;

export const splitWords = (text: string): string[] =>
  text
    .split(SEPARATOR)
    .map((s) => s.trim())
    .filter(Boolean);

export function TagInput({ id, value, onChange, placeholder, disabled, ...aria }: Props) {
  const t = useT();
  const [draft, setDraft] = useState('');
  const input = useRef<HTMLInputElement>(null);

  /** Add words that are not in the list yet (case-sensitive, order kept). */
  const add = (words: string[]) => {
    const fresh = words.filter((w, i) => !value.includes(w) && words.indexOf(w) === i);
    if (fresh.length > 0) onChange([...value, ...fresh]);
  };
  const commit = () => {
    add(splitWords(draft));
    setDraft('');
  };
  const removeAt = (index: number) => {
    onChange(value.filter((_, i) => i !== index));
    input.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    // Never act on a key that belongs to the IME.
    if (event.nativeEvent.isComposing || event.keyCode === 229) return;
    if (event.key === 'Enter') {
      // Enter in this box adds a word; it must not submit or trigger anything around it.
      event.preventDefault();
      commit();
    } else if (event.key === 'Backspace' && draft === '' && value.length > 0) {
      onChange(value.slice(0, -1));
    }
  };

  const onInput = (event: ChangeEvent<HTMLInputElement>) => {
    const text = event.target.value;
    const composing = (event.nativeEvent as InputEvent).isComposing === true;
    if (!composing && SEPARATOR.test(text)) {
      // A comma (or pasted list) ends the word(s); whatever follows the last separator stays in the box.
      const parts = text.split(SEPARATOR);
      const rest = parts.pop() ?? '';
      add(parts.map((s) => s.trim()).filter(Boolean));
      setDraft(rest.trimStart());
    } else {
      setDraft(text);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const text = event.clipboardData.getData('text');
    if (!SEPARATOR.test(text)) return;
    event.preventDefault();
    add(splitWords(draft + text));
    setDraft('');
  };

  return (
    <div
      className={cx('raf-tags', disabled && 'is-disabled')}
      onClick={(event) => {
        if (event.target === event.currentTarget) input.current?.focus();
      }}
    >
      {value.map((word, index) => (
        <span key={word} className="raf-tag">
          {word}
          <button type="button" className="raf-tag__remove" aria-label={t('options.tagRemove', { tag: word })} disabled={disabled} onClick={() => removeAt(index)}>
            <Icon name="x-lg" size={12} />
          </button>
        </span>
      ))}
      <input
        {...aria}
        ref={input}
        id={id}
        type="text"
        className="raf-tags__input"
        value={draft}
        disabled={disabled}
        placeholder={value.length === 0 ? placeholder : undefined}
        onChange={onInput}
        onKeyDown={onKeyDown}
        onPaste={onPaste}
        onBlur={commit}
      />
    </div>
  );
}
