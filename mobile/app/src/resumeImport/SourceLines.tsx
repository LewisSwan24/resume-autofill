// 看原文: the five lines of the file around the one a value was read from, the source line marked. Only those five
// are ever rendered, so a long file never lands in the page.
import type { TextLine } from '../../../../src/import/extract/types';
import { useMT } from '../i18n';

export function SourceLines({ id, lines, line }: { id: string; lines: readonly TextLine[]; line: number }) {
  const t = useMT();
  const from = Math.max(0, line - 2);
  const to = Math.min(lines.length - 1, line + 2);
  const shown: number[] = [];
  for (let i = from; i <= to; i += 1) shown.push(i);
  return (
    <ol id={id} className="m-ri-source">
      {shown.map((i) => (
        <li key={i} className="m-ri-source__line" aria-current={i === line ? 'true' : undefined}>
          <span className="m-ri-source__no">{t('m.ri.sourceLine', { n: i + 1 })}</span>
          <span className="m-ri-source__text">{lines[i]!.text}</span>
        </li>
      ))}
    </ol>
  );
}
