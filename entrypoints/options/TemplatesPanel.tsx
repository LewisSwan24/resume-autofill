// Options tab: offline resume template preview + Word (.docx) & printable PDF export.
import { useMemo, useRef, useState } from 'react';
import { useT } from '../../src/i18n';
import { materializeResume, type Resume } from '../../src/schema';
import {
  RESUME_TEMPLATES,
  renderResumeDocx,
  renderResumeHtml,
  resumeFullName,
  type ResumeTemplateId,
} from '../../src/templates';
import { Button, EmptyState, Notice } from './ui/controls';

interface TemplatesPanelProps {
  resume: Resume | null;
  allResumes?: readonly Resume[];
}

export function TemplatesPanel({ resume, allResumes }: TemplatesPanelProps) {
  const t = useT();
  const [templateId, setTemplateId] = useState<ResumeTemplateId>('ats_clean');
  const [exportingDocx, setExportingDocx] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);

  const effectiveResume = useMemo(
    () => (resume ? materializeResume(resume, allResumes ?? [resume]) : null),
    [resume, allResumes],
  );
  const html = useMemo(() => (effectiveResume ? renderResumeHtml(effectiveResume, templateId) : ''), [effectiveResume, templateId]);

  if (!effectiveResume) {
    return <EmptyState icon="file-earmark-text">{t('options.templates.noResume')}</EmptyState>;
  }

  const baseName = (resumeFullName(effectiveResume) || effectiveResume.title.trim() || 'resume').replace(/[\\/:*?"<>|]/g, '_');

  const downloadDocx = async () => {
    setExportingDocx(true);
    try {
      const bytes = await renderResumeDocx(effectiveResume, templateId);
      const copy = new Uint8Array(bytes.byteLength);
      copy.set(bytes);
      const blob = new Blob([copy.buffer], {
        type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${baseName}-${templateId}.docx`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } finally {
      setExportingDocx(false);
    }
  };

  const printPdf = () => {
    const win = iframeRef.current?.contentWindow;
    if (win && typeof win.print === 'function') {
      win.focus();
      win.print();
      return;
    }
    const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
    window.open(url, '_blank', 'noopener,noreferrer');
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  return (
    <div className="raf-form-stack">
      <Notice>{t('options.templates.lead')}</Notice>

      <div className="raf-tpl-grid" role="radiogroup" aria-label={t('options.templates.select')}>
        {RESUME_TEMPLATES.map((tpl) => {
          const selected = tpl.id === templateId;
          return (
            <button
              key={tpl.id}
              type="button"
              role="radio"
              aria-checked={selected}
              className={`raf-tpl-card${selected ? ' is-selected' : ''}`}
              onClick={() => setTemplateId(tpl.id)}
            >
              <strong className="raf-tpl-card__title">{t(tpl.nameKey)}</strong>
              <span className="raf-tpl-card__desc">{t(tpl.descKey)}</span>
            </button>
          );
        })}
      </div>

      <div className="raf-row">
        <Button icon="download" variant="primary" disabled={exportingDocx} onClick={() => void downloadDocx()}>
          {t('options.templates.exportDocx')}
        </Button>
        <Button icon="file-earmark-text" onClick={printPdf}>
          {t('options.templates.exportPrint')}
        </Button>
      </div>

      <div className="raf-tpl-preview">
        <iframe
          ref={iframeRef}
          className="raf-tpl-frame"
          title={t('options.templates.preview')}
          srcDoc={html}
        />
      </div>
    </div>
  );
}
