// Compact 5-dimension ATS Resume Health Audit card for the Options editor with one-click jump links.
import { useMemo } from 'react';
import { auditResume, type AuditDimensionId } from '../../src/audit';
import type { ProfileTarget } from '../../src/editor';
import { useT, type MessageKey } from '../../src/i18n';
import type { Resume } from '../../src/schema';
import { Badge, Button, Notice } from './ui/controls';

const DIM_KEY: Record<AuditDimensionId, MessageKey> = {
  contactCompleteness: 'options.audit.dim.contactCompleteness',
  quantificationDensity: 'options.audit.dim.quantificationDensity',
  actionVerbDiversity: 'options.audit.dim.actionVerbDiversity',
  timelineConsistency: 'options.audit.dim.timelineConsistency',
  skillsAndQaReadiness: 'options.audit.dim.skillsAndQaReadiness',
};

interface AuditCardProps {
  resume: Resume;
  onJump: (target: ProfileTarget) => void;
}

export function AuditCard({ resume, onJump }: AuditCardProps) {
  const t = useT();
  const report = useMemo(() => auditResume(resume), [resume]);

  return (
    <section className="raf-audit-card" aria-label={t('options.audit.title')}>
      <div className="raf-audit-header">
        <strong>{t('options.audit.title')}</strong>
        <Badge tone={report.overallScore < 55 ? 'danger' : 'default'}>
          {t('options.audit.scoreLine', { score: report.overallScore, grade: report.grade })}
        </Badge>
      </div>

      <div className="raf-audit-dims">
        {report.dimensions.map((d) => (
          <div key={d.id} className="raf-audit-dim">
            <span className="raf-caption">{t(DIM_KEY[d.id])}</span>
            <Badge tone={d.status === 'needs_work' ? 'danger' : 'default'}>
              {d.score}%
            </Badge>
          </div>
        ))}
      </div>

      {report.findings.length === 0 ? (
        <Notice tone="info">{t('options.audit.allClean')}</Notice>
      ) : (
        <div className="raf-audit-findings">
          {report.findings.slice(0, 6).map((f) => (
            <div key={f.id} className="raf-audit-finding">
              <span className="raf-caption">{t(f.messageKey, f.messageParams)}</span>
              {f.target ? (
                <Button onClick={() => onJump(f.target!)}>{t('options.audit.jumpFix')}</Button>
              ) : null}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
