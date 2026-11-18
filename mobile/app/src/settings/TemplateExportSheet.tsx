// Mobile offline resume template exporter: 4 layouts + Word (.docx) + native PrintManager / UIPrint PDF bridge.
import { useMemo, useState } from 'react';
import { materializeResume, type Profile } from '../../../../src/schema';
import {
  RESUME_TEMPLATES,
  renderResumeDocx,
  renderResumeHtml,
  resumeFullName,
  type ResumeTemplateId,
} from '../../../../src/templates';
import { useMT } from '../i18n';
import { printResumeOffline, type PrintBridgePlugin } from '../native/printBridge';
import { Sheet, type ToastMessage } from '../ui';
import type { SaveDocument } from './ExportSheet';

export interface TemplateExportSheetProps {
  open: boolean;
  onClose: () => void;
  profile: Profile | null;
  saveDocument?: SaveDocument;
  printBridge?: PrintBridgePlugin;
  showToast: (toast: Omit<ToastMessage, 'id'>) => void;
}

export function TemplateExportSheet(props: TemplateExportSheetProps) {
  const t = useMT();
  return (
    <Sheet open={props.open} title={t('m.tpl.title')} onClose={props.onClose}>
      <TemplateExportBody {...props} />
    </Sheet>
  );
}

function TemplateExportBody({ profile, saveDocument, printBridge, showToast }: TemplateExportSheetProps) {
  const t = useMT();
  const [templateId, setTemplateId] = useState<ResumeTemplateId>('ats_clean');
  const [busy, setBusy] = useState(false);

  const resume = useMemo(() => {
    if (!profile || profile.resumes.length === 0) return null;
    const raw = profile.resumes.find((r) => r.id === profile.activeResumeId) ?? profile.resumes[0]!;
    return materializeResume(raw, profile.resumes);
  }, [profile]);

  const html = useMemo(() => (resume ? renderResumeHtml(resume, templateId) : ''), [resume, templateId]);

  if (!resume) {
    return <p className="m-sheet-text">{t('m.tpl.empty')}</p>;
  }

  const baseName = (resumeFullName(resume) || resume.title.trim() || 'resume').replace(/[\\/:*?"<>|]/g, '_');

  const handlePrint = async () => {
    setBusy(true);
    try {
      const ok = await printResumeOffline(html, `${baseName}-${templateId}`, printBridge);
      if (!ok) showToast({ text: t('m.tpl.printUnsupported') });
    } finally {
      setBusy(false);
    }
  };

  const handleDocx = async () => {
    if (!saveDocument) return;
    setBusy(true);
    try {
      const bytes = await renderResumeDocx(resume, templateId);
      const res = await saveDocument({
        name: `${baseName}-${templateId}.docx`,
        mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        bytes,
      });
      if (res === 'saved') showToast({ text: t('m.export.done') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="m-sheet-stack">
      <div className="m-sheet-stack">
        {RESUME_TEMPLATES.map((tpl) => (
          <label key={tpl.id} className="m-check">
            <input type="radio" name="m-tpl-id" checked={templateId === tpl.id} onChange={() => setTemplateId(tpl.id)} />
            <span>{t(tpl.nameKey)}</span>
          </label>
        ))}
      </div>

      <iframe
        title={t('m.tpl.title')}
        srcDoc={html}
        style={{ width: '100%', height: 260, border: '1px solid var(--m-border)', borderRadius: 8, background: '#fff' }}
      />

      <button type="button" className="m-button m-button--primary m-button--wide" disabled={busy} onClick={() => void handlePrint()}>
        {t('m.tpl.printPdf')}
      </button>
      <button type="button" className="m-button m-button--wide" disabled={busy || !saveDocument} onClick={() => void handleDocx()}>
        {t('m.tpl.exportDocx')}
      </button>
    </div>
  );
}
