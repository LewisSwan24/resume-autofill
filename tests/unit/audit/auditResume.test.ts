import { describe, expect, it } from 'vitest';
import { AUDIT_DIMENSION_IDS, auditResume } from '../../../src/audit';
import { ResumeSchema } from '../../../src/schema';

describe('audit/auditResume', () => {
  it('flags missing sections with actionable deep-link targets on an empty resume', () => {
    const empty = ResumeSchema.parse({ id: 'empty', title: 'Blank', locale: 'zh-CN' });
    const report = auditResume(empty);

    expect(report.dimensions.map((d) => d.id)).toEqual([...AUDIT_DIMENSION_IDS]);
    expect(report.grade).toBe('D');
    expect(report.overallScore).toBeLessThan(35);
    expect(report.findings.some((f) => f.target?.module === 'contact' && f.target.field === 'email')).toBe(true);
    expect(report.findings.some((f) => f.target?.module === 'about' && f.target.field === 'selfIntroduction')).toBe(true);
  });

  it('detects unquantified experiences, reversed dates, and long gaps', () => {
    const flawed = ResumeSchema.parse({
      id: 'flawed',
      title: 'Gap Check',
      locale: 'en-AU',
      basics: { familyName: 'Doe', givenName: 'Jane' },
      contact: { email: 'jane@example.com', phone: '0412345678' },
      education: [{ school: 'UNSW', startDate: '2018-02', endDate: '2021-11', current: false }],
      work: [
        {
          company: 'OldCorp',
          position: 'Dev',
          startDate: '2020-01',
          endDate: '2021-01',
          current: false,
          description: 'Helped teammates write web pages.',
        },
        {
          company: 'NextCorp',
          position: 'Eng',
          startDate: '2023-06',
          endDate: '2022-01',
          current: false,
          description: 'Maintained dashboard widgets.',
        },
      ],
    });

    const report = auditResume(flawed);
    const timeline = report.dimensions.find((d) => d.id === 'timelineConsistency')!;
    const quant = report.dimensions.find((d) => d.id === 'quantificationDensity')!;

    expect(quant.score).toBe(0);
    expect(timeline.findings.some((f) => f.messageKey === 'audit.finding.reversedDates')).toBe(true);
    expect(timeline.findings.some((f) => f.target?.module === 'work' && f.target.field === 'startDate')).toBe(true);
  });

  it('scores high (Grade A) on a complete, quantified, gap-free bilingual resume', () => {
    const strong = ResumeSchema.parse({
      id: 'strong',
      title: 'Staff Engineer',
      locale: 'zh-CN',
      basics: { familyName: '林', givenName: '晴' },
      contact: { email: 'qing@example.com', phone: '13912345678' },
      jobIntention: { positions: ['后端工程师'], cities: ['北京'] },
      education: [{ school: '清华大学', major: '计算机', startDate: '2017-09', endDate: '2021-06', current: false }],
      work: [
        {
          company: '云帆',
          position: '研发工程师',
          startDate: '2021-07',
          endDate: '2023-08',
          current: false,
          description: '主导并重构分布式网关核心链路，优化缓存策略，使 P99 延迟降低 38%，吞吐提升 2 倍。',
        },
        {
          company: '星图',
          position: '高级工程师',
          startDate: '2023-09',
          endDate: null,
          current: true,
          description: '设计并落地高可用任务调度系统，实现 99.99% SLA 并自动化发布流程。',
        },
      ],
      projects: [
        {
          name: 'LocalVault',
          role: 'Owner',
          startDate: '2024-01',
          endDate: null,
          current: true,
          description: 'Architected and launched zero-knowledge sync vault reducing payload size by 72%.',
        },
      ],
      skills: [
        { name: 'Go', level: 'Expert' },
        { name: 'TypeScript', level: 'Expert' },
        { name: 'Kubernetes', level: 'Proficient' },
        { name: 'Redis', level: 'Proficient' },
      ],
      selfIntroduction: '五年后端与分布式系统研发经验，擅长高并发架构设计与系统性能调优。',
      customAnswers: [
        { question: '优势', answer: '具备完整从零到一高并发系统落地与稳定性治理经验。' },
        { question: 'Why us', answer: 'Strong alignment with reliable local-first developer tools.' },
      ],
    });

    const report = auditResume(strong);
    expect(report.overallScore).toBeGreaterThanOrEqual(85);
    expect(report.grade).toBe('A');
    expect(report.findings.filter((f) => f.severity === 'high')).toHaveLength(0);
  });
});
