// 5-dimension pure TypeScript Resume ATS Health Audit with direct profile jump targets.
import { targetOfField, type ProfileTarget } from '../editor/fieldTarget';
import type { Resume } from '../schema';

export const AUDIT_DIMENSION_IDS = [
  'contactCompleteness',
  'quantificationDensity',
  'actionVerbDiversity',
  'timelineConsistency',
  'skillsAndQaReadiness',
] as const;

export type AuditDimensionId = (typeof AUDIT_DIMENSION_IDS)[number];
export type AuditSeverity = 'high' | 'medium' | 'low';
export type AuditStatus = 'good' | 'fair' | 'needs_work';
export type AuditGrade = 'A' | 'B' | 'C' | 'D';

export interface AuditFinding {
  id: string;
  dimensionId: AuditDimensionId;
  severity: AuditSeverity;
  messageKey: string;
  messageParams?: Record<string, string | number>;
  target: ProfileTarget | null;
}

export interface AuditDimensionReport {
  id: AuditDimensionId;
  score: number;
  weight: number;
  status: AuditStatus;
  findings: AuditFinding[];
}

export interface ResumeAuditReport {
  overallScore: number;
  grade: AuditGrade;
  dimensions: AuditDimensionReport[];
  findings: AuditFinding[];
}

const METRIC_RE = /\d+(?:\.\d+)?\s*(?:%|倍|x|ms|s|万|亿|k|m|\$|qps|rps|dau|mau|fps|pb|tb|gb)/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const ACTION_VERBS_ZH = [
  '主导', '设计', '构建', '优化', '重构', '推进', '实现', '落地', '搭建', '拆分',
  '提升', '降低', '缩短', '负责', '研发', '编写', '维护', '协调', '组织', '创立',
];
const ACTION_VERBS_EN = [
  'built', 'designed', 'led', 'architected', 'optimized', 'reduced', 'delivered',
  'launched', 'scaled', 'implemented', 'automated', 'refactored', 'improved', 'created',
  'drove', 'shipped', 'managed', 'established', 'mentored', 'developed',
];

function statusOf(score: number): AuditStatus {
  if (score >= 80) return 'good';
  if (score >= 55) return 'fair';
  return 'needs_work';
}

function gradeOf(score: number): AuditGrade {
  if (score >= 85) return 'A';
  if (score >= 70) return 'B';
  if (score >= 50) return 'C';
  return 'D';
}

function toYearMonthNum(dateStr: string | null | undefined, current: boolean): number | null {
  if (current) {
    const now = new Date();
    return now.getFullYear() * 12 + now.getMonth();
  }
  const s = (dateStr ?? '').trim();
  const m = /^(\d{4})-(\d{2})/.exec(s);
  if (!m) return null;
  return Number(m[1]) * 12 + (Number(m[2]) - 1);
}

function auditContactCompleteness(resume: Resume): AuditDimensionReport {
  const findings: AuditFinding[] = [];
  let pts = 0;

  const hasName = Boolean(resume.basics.familyName.trim() || resume.basics.givenName.trim() || resume.basics.preferredName.trim());
  if (hasName) pts += 25;
  else findings.push({ id: 'contact-name', dimensionId: 'contactCompleteness', severity: 'high', messageKey: 'audit.finding.missingName', target: targetOfField('basics.familyName') });

  if (EMAIL_RE.test(resume.contact.email.trim())) pts += 25;
  else findings.push({ id: 'contact-email', dimensionId: 'contactCompleteness', severity: 'high', messageKey: 'audit.finding.missingEmail', target: targetOfField('contact.email') });

  if (resume.contact.phone.trim().length >= 6) pts += 20;
  else findings.push({ id: 'contact-phone', dimensionId: 'contactCompleteness', severity: 'high', messageKey: 'audit.finding.missingPhone', target: targetOfField('contact.phone') });

  if (resume.jobIntention.positions.length > 0 && resume.jobIntention.cities.length > 0) pts += 15;
  else findings.push({ id: 'contact-intention', dimensionId: 'contactCompleteness', severity: 'medium', messageKey: 'audit.finding.missingIntention', target: targetOfField('jobIntention.positions') });

  if (resume.education.length > 0 && resume.education.some((e) => e.school.trim().length > 0)) pts += 15;
  else findings.push({ id: 'contact-edu', dimensionId: 'contactCompleteness', severity: 'medium', messageKey: 'audit.finding.missingEducation', target: targetOfField('education.school', 'education[0].school') });

  const score = Math.min(100, pts);
  return { id: 'contactCompleteness', score, weight: 0.25, status: statusOf(score), findings };
}

function auditQuantificationDensity(resume: Resume): AuditDimensionReport {
  const findings: AuditFinding[] = [];
  const entries = [
    ...resume.work.map((w, idx) => ({ kind: 'work' as const, idx, label: w.company || w.position || `Work ${idx + 1}`, desc: w.description })),
    ...resume.projects.map((p, idx) => ({ kind: 'projects' as const, idx, label: p.name || `Project ${idx + 1}`, desc: p.description })),
  ];

  if (entries.length === 0) {
    findings.push({
      id: 'quant-no-exp',
      dimensionId: 'quantificationDensity',
      severity: 'high',
      messageKey: 'audit.finding.noExperienceEntries',
      target: targetOfField('work.description', 'work[0].description'),
    });
    return { id: 'quantificationDensity', score: 0, weight: 0.25, status: 'needs_work', findings };
  }

  let quantifiedCount = 0;
  for (const e of entries) {
    if (METRIC_RE.test(e.desc)) {
      quantifiedCount++;
    } else {
      findings.push({
        id: `quant-${e.kind}-${e.idx}`,
        dimensionId: 'quantificationDensity',
        severity: e.kind === 'work' ? 'high' : 'medium',
        messageKey: 'audit.finding.unquantifiedExperience',
        messageParams: { name: e.label },
        target: targetOfField(`${e.kind}.description`, `${e.kind}[${e.idx}].description`),
      });
    }
  }

  const score = Math.round((quantifiedCount / entries.length) * 100);
  return { id: 'quantificationDensity', score, weight: 0.25, status: statusOf(score), findings };
}

function auditActionVerbDiversity(resume: Resume): AuditDimensionReport {
  const findings: AuditFinding[] = [];
  const descriptions = [
    ...resume.work.map((w) => w.description),
    ...resume.projects.map((p) => p.description),
    ...resume.campus.map((c) => c.description),
  ]
    .map((d) => d.trim())
    .filter(Boolean);

  if (descriptions.length === 0) {
    findings.push({
      id: 'verbs-empty',
      dimensionId: 'actionVerbDiversity',
      severity: 'medium',
      messageKey: 'audit.finding.lowVerbDiversity',
      messageParams: { count: 0 },
      target: targetOfField('work.description', 'work[0].description'),
    });
    return { id: 'actionVerbDiversity', score: 0, weight: 0.2, status: 'needs_work', findings };
  }

  const combinedLower = descriptions.join('\n').toLowerCase();
  const matched = new Set<string>();
  for (const zh of ACTION_VERBS_ZH) {
    if (combinedLower.includes(zh)) matched.add(zh);
  }
  for (const en of ACTION_VERBS_EN) {
    if (new RegExp(`\\b${en}\\b`, 'i').test(combinedLower)) matched.add(en);
  }

  // Expect >= 4 distinct strong action verbs across work/project descriptions for 100%.
  const targetVerbs = Math.max(4, Math.min(8, descriptions.length * 2));
  const score = Math.min(100, Math.round((matched.size / targetVerbs) * 100));
  if (score < 80) {
    const firstTarget = resume.work.length > 0
      ? targetOfField('work.description', 'work[0].description')
      : targetOfField('projects.description', 'projects[0].description');
    findings.push({
      id: 'verbs-low',
      dimensionId: 'actionVerbDiversity',
      severity: score < 50 ? 'medium' : 'low',
      messageKey: 'audit.finding.lowVerbDiversity',
      messageParams: { count: matched.size },
      target: firstTarget,
    });
  }
  return { id: 'actionVerbDiversity', score, weight: 0.2, status: statusOf(score), findings };
}

function auditTimelineConsistency(resume: Resume): AuditDimensionReport {
  const findings: AuditFinding[] = [];
  let penalties = 0;

  const checkSeries = (
    module: 'education' | 'work' | 'projects',
    rows: ReadonlyArray<{ startDate: string; endDate: string | null; current: boolean; label: string }>,
    checkGaps: boolean,
  ) => {
    const parsed: Array<{ idx: number; start: number; end: number; label: string }> = [];
    rows.forEach((row, idx) => {
      const start = toYearMonthNum(row.startDate, false);
      const end = toYearMonthNum(row.endDate, row.current);
      if (start === null || end === null) {
        penalties += 10;
        findings.push({
          id: `timeline-missing-${module}-${idx}`,
          dimensionId: 'timelineConsistency',
          severity: 'low',
          messageKey: 'audit.finding.incompleteDates',
          messageParams: { name: row.label },
          target: targetOfField(`${module}.startDate`, `${module}[${idx}].startDate`),
        });
        return;
      }
      if (start > end) {
        penalties += 30;
        findings.push({
          id: `timeline-reversed-${module}-${idx}`,
          dimensionId: 'timelineConsistency',
          severity: 'high',
          messageKey: 'audit.finding.reversedDates',
          messageParams: { name: row.label },
          target: targetOfField(`${module}.startDate`, `${module}[${idx}].startDate`),
        });
        return;
      }
      parsed.push({ idx, start, end, label: row.label });
    });

    if (checkGaps && parsed.length > 1) {
      const ordered = [...parsed].sort((a, b) => a.start - b.start);
      for (let i = 1; i < ordered.length; i++) {
        const prev = ordered[i - 1]!;
        const curr = ordered[i]!;
        if (curr.start - prev.end >= 6) {
          penalties += 15;
          findings.push({
            id: `timeline-gap-${module}-${curr.idx}`,
            dimensionId: 'timelineConsistency',
            severity: 'low',
            messageKey: 'audit.finding.timelineGap',
            messageParams: { months: curr.start - prev.end, name: curr.label },
            target: targetOfField(`${module}.startDate`, `${module}[${curr.idx}].startDate`),
          });
        }
      }
    }
  };

  checkSeries(
    'education',
    resume.education.map((e, i) => ({ ...e, label: e.school || `Education ${i + 1}` })),
    false,
  );
  checkSeries(
    'work',
    resume.work.map((w, i) => ({ ...w, label: w.company || `Work ${i + 1}` })),
    true,
  );
  checkSeries(
    'projects',
    resume.projects.map((p, i) => ({ ...p, label: p.name || `Project ${i + 1}` })),
    false,
  );

  const score = Math.max(0, 100 - penalties);
  return { id: 'timelineConsistency', score, weight: 0.15, status: statusOf(score), findings };
}

function auditSkillsAndQaReadiness(resume: Resume): AuditDimensionReport {
  const findings: AuditFinding[] = [];
  let pts = 0;

  if (resume.skills.length >= 4) pts += 35;
  else {
    if (resume.skills.length > 0) pts += 15;
    findings.push({
      id: 'readiness-skills',
      dimensionId: 'skillsAndQaReadiness',
      severity: 'medium',
      messageKey: 'audit.finding.fewSkills',
      messageParams: { count: resume.skills.length },
      target: targetOfField('skills.name', 'skills[0].name'),
    });
  }

  if (resume.selfIntroduction.trim().length >= 40) pts += 30;
  else {
    findings.push({
      id: 'readiness-intro',
      dimensionId: 'skillsAndQaReadiness',
      severity: 'medium',
      messageKey: 'audit.finding.shortSelfIntro',
      target: targetOfField('misc.selfIntroduction'),
    });
  }

  const validQa = resume.customAnswers.filter((qa) => qa.question.trim() && qa.answer.trim()).length;
  if (validQa >= 2) pts += 35;
  else {
    if (validQa === 1) pts += 18;
    findings.push({
      id: 'readiness-qa',
      dimensionId: 'skillsAndQaReadiness',
      severity: 'low',
      messageKey: 'audit.finding.fewCustomAnswers',
      messageParams: { count: validQa },
      target: targetOfField('customAnswers.question', 'customAnswers[0].question'),
    });
  }

  const score = Math.min(100, pts);
  return { id: 'skillsAndQaReadiness', score, weight: 0.15, status: statusOf(score), findings };
}

/** Execute a deterministic 5-dimension ATS & readability health audit on a resume. */
export function auditResume(resume: Resume): ResumeAuditReport {
  const dimensions: AuditDimensionReport[] = [
    auditContactCompleteness(resume),
    auditQuantificationDensity(resume),
    auditActionVerbDiversity(resume),
    auditTimelineConsistency(resume),
    auditSkillsAndQaReadiness(resume),
  ];

  const overallScore = Math.round(dimensions.reduce((sum, d) => sum + d.score * d.weight, 0));
  const severityRank: Record<AuditSeverity, number> = { high: 0, medium: 1, low: 2 };
  const findings = dimensions
    .flatMap((d) => d.findings)
    .sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);

  return {
    overallScore,
    grade: gradeOf(overallScore),
    dimensions,
    findings,
  };
}
