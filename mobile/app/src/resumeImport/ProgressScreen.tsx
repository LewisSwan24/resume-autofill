// 正在读取简历: the file, two steps (read the text, work out what each part is), a polite status line, a note that
// nothing leaves the phone, and 取消. After 8 s still reading, one more line says the file is long.
import { useEffect, useState } from 'react';
import { formatSize } from '../../../../entrypoints/options/format';
import { Icon } from '../Icon';
import { useMT } from '../i18n';
import { IconButton } from '../ui';
import type { ImportKind, ReadPhase } from './types';

const SLOW_MS = 8000;

export interface ProgressScreenProps {
  headingId: string;
  name: string;
  /** Unknown while another app's file is still being read on the native side. */
  size: number | null;
  kind: ImportKind;
  phase: ReadPhase;
  startedAt: number;
  onCancel: () => void;
}

export function ProgressScreen({ headingId, name, size, kind, phase, startedAt, onCancel }: ProgressScreenProps) {
  const t = useMT();
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    setSlow(false);
    const timer = setTimeout(() => setSlow(true), Math.max(0, SLOW_MS - (Date.now() - startedAt)));
    return () => clearTimeout(timer);
  }, [startedAt]);

  const steps: Array<{ key: string; state: 'done' | 'now' | 'next' }> = [
    { key: 'm.ri.step.read', state: phase === 'reading' ? 'now' : 'done' },
    { key: 'm.ri.step.parse', state: phase === 'reading' ? 'next' : 'now' },
  ];
  const current = steps.find((s) => s.state === 'now')!;

  return (
    <>
      <header className="m-header m-header--module">
        <IconButton icon="arrow-left" label={t('m.back')} onClick={onCancel} />
        <h1 id={headingId} className="m-title" tabIndex={-1}>
          {t('m.ri.progressTitle')}
        </h1>
      </header>
      <div className="m-ri-body">
        {name || size !== null ? (
          <div className="m-card m-card--padded m-file">
            <span className="m-row__tile">
              <Icon name={kind === 'docx' ? 'file-earmark-word' : 'file-earmark-pdf'} />
            </span>
            <span className="m-file__text">
              {name ? <span className="m-file__name">{name}</span> : null}
              {size !== null ? <span className="m-file__meta">{formatSize(size)}</span> : null}
            </span>
          </div>
        ) : null}
        <ol className="m-card m-card--padded m-ri-steps">
          {steps.map((s) => (
            <li key={s.key} className={s.state === 'now' ? 'm-ri-step m-ri-step--now' : s.state === 'done' ? 'm-ri-step m-ri-step--done' : 'm-ri-step'}>
              {s.state === 'now' ? <span className="m-ri-spinner" aria-hidden="true" /> : null}
              {s.state === 'done' ? <Icon name="check-circle" /> : null}
              {s.state === 'next' ? <span className="m-ri-step__dot" aria-hidden="true" /> : null}
              <span>{t(s.key)}</span>
              {s.state !== 'next' ? <span className="m-ri-hidden">{t(s.state === 'done' ? 'm.ri.stepDone' : 'm.ri.stepNow')}</span> : null}
            </li>
          ))}
        </ol>
        <p className="m-status m-ri-status" role="status" aria-live="polite">
          {t(current.key)}
        </p>
        {slow ? <p className="m-help">{t('m.ri.slow')}</p> : null}
        <p className="m-help">
          <Icon name="lock" />
          <span>{t('m.ri.localNote')}</span>
        </p>
      </div>
      <div className="m-ri-bar">
        <button type="button" className="m-button" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </>
  );
}
