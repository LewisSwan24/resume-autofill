// Offline Word (.docx) generator using `docx` for the 4 resume templates.
import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { Resume } from '../schema';
import { resumeFullName } from './presets';
import { formatPeriod, joinContact, labelsFor, splitBullets, type Labels, type ResumeTemplateId } from './renderHtml';

function heading(text: string): Paragraph {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 180, after: 80 },
    border: { bottom: { color: 'CBD5E1', space: 3, style: BorderStyle.SINGLE, size: 6 } },
    children: [new TextRun({ text, bold: true, size: 22 })],
  });
}

function subhead(left: string, right: string): Paragraph {
  return new Paragraph({
    spacing: { before: 100, after: 40 },
    children: [
      new TextRun({ text: left, bold: true, size: 20 }),
      ...(right ? [new TextRun({ text: `   ${right}`, color: '64748B', size: 18 })] : []),
    ],
  });
}

function bulletsOf(text: string): Paragraph[] {
  return splitBullets(text).map(
    (b) =>
      new Paragraph({
        bullet: { level: 0 },
        spacing: { after: 30 },
        children: [new TextRun({ text: b, size: 19 })],
      }),
  );
}

function sectionSummary(resume: Resume, l: Labels): Paragraph[] {
  const out: Paragraph[] = [];
  if (resume.selfIntroduction.trim()) {
    out.push(heading(l.summary), new Paragraph({ children: [new TextRun({ text: resume.selfIntroduction.trim(), size: 19 })] }));
  }
  if (resume.jobIntention.positions.length > 0 || resume.workRights.status) {
    const bits: string[] = [];
    if (resume.jobIntention.positions.length > 0) bits.push(resume.jobIntention.positions.join(', '));
    if (resume.jobIntention.cities.length > 0) bits.push(resume.jobIntention.cities.join(', '));
    if (resume.workRights.status) bits.push(`Work rights: ${resume.workRights.status}`);
    out.push(heading(l.workRights), new Paragraph({ children: [new TextRun({ text: bits.join(' · '), size: 19 })] }));
  }
  return out;
}

function sectionEducation(resume: Resume, l: Labels): Paragraph[] {
  if (resume.education.length === 0) return [];
  const out: Paragraph[] = [heading(l.education)];
  for (const ed of resume.education) {
    out.push(subhead(ed.school || '—', formatPeriod(ed.startDate, ed.endDate, ed.current, l.present)));
    const details = [
      ed.major.trim(),
      ed.gpa.trim() ? `${l.gpa}: ${ed.gpa.trim()}${ed.gpaScale.trim() ? `/${ed.gpaScale.trim()}` : ''}` : '',
      ed.ranking.trim() ? `${l.rank}: ${ed.ranking.trim()}` : '',
    ]
      .filter(Boolean)
      .join(' · ');
    if (details) out.push(new Paragraph({ children: [new TextRun({ text: details, size: 19 })] }));
  }
  return out;
}

function sectionWork(resume: Resume, l: Labels): Paragraph[] {
  if (resume.work.length === 0) return [];
  const out: Paragraph[] = [heading(l.work)];
  for (const w of resume.work) {
    out.push(subhead([w.company.trim(), w.position.trim()].filter(Boolean).join(' · ') || '—', formatPeriod(w.startDate, w.endDate, w.current, l.present)));
    out.push(...bulletsOf(w.description));
  }
  return out;
}

function sectionProjects(resume: Resume, l: Labels): Paragraph[] {
  if (resume.projects.length === 0) return [];
  const out: Paragraph[] = [heading(l.projects)];
  for (const p of resume.projects) {
    out.push(subhead([p.name.trim(), p.role.trim()].filter(Boolean).join(' · ') || '—', formatPeriod(p.startDate, p.endDate, p.current, l.present)));
    if (p.link.trim()) {
      out.push(new Paragraph({ children: [new TextRun({ text: p.link.trim(), color: '475569', size: 18 })] }));
    }
    out.push(...bulletsOf(p.description));
  }
  return out;
}

function sectionCampus(resume: Resume, l: Labels): Paragraph[] {
  if (resume.campus.length === 0) return [];
  const out: Paragraph[] = [heading(l.campus)];
  for (const c of resume.campus) {
    out.push(subhead([c.organization.trim(), c.role.trim()].filter(Boolean).join(' · ') || '—', formatPeriod(c.startDate, c.endDate, c.current, l.present)));
    out.push(...bulletsOf(c.description));
  }
  return out;
}

function sectionSkillsAndExtras(resume: Resume, l: Labels): Paragraph[] {
  const out: Paragraph[] = [];
  if (resume.skills.length > 0) {
    out.push(
      heading(l.skills),
      new Paragraph({ children: [new TextRun({ text: resume.skills.map((s) => (s.level ? `${s.name} (${s.level})` : s.name)).join(' · '), size: 19 })] }),
    );
  }
  if (resume.languages.length > 0) {
    out.push(
      heading(l.languages),
      new Paragraph({ children: [new TextRun({ text: resume.languages.map((lang) => [lang.language, lang.certificate, lang.score].filter(Boolean).join(' ')).join(' · '), size: 19 })] }),
    );
  }
  if (resume.awards.length > 0) {
    out.push(heading(l.awards));
    for (const a of resume.awards) {
      out.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: [a.name, a.level, a.date].filter(Boolean).join(' · '), size: 19 })] }));
    }
  }
  return out;
}

function sectionReferees(resume: Resume, l: Labels): Paragraph[] {
  if (resume.referees.length === 0) return [];
  const out: Paragraph[] = [heading(l.referees)];
  for (const r of resume.referees) {
    out.push(new Paragraph({ bullet: { level: 0 }, children: [new TextRun({ text: [r.name, r.title, r.company, r.email, r.phone].filter(Boolean).join(' · '), size: 19 })] }));
  }
  return out;
}

/** Generate an offline Word `.docx` binary for the chosen template. */
export async function renderResumeDocx(resume: Resume, templateId: ResumeTemplateId): Promise<Uint8Array> {
  const l = labelsFor(resume);
  const name = resumeFullName(resume) || resume.title.trim() || 'Resume';
  const contactLine = joinContact(resume).join('  |  ');

  const headerParagraphs = [
    new Paragraph({
      alignment: templateId === 'au_grad' ? AlignmentType.CENTER : AlignmentType.LEFT,
      children: [new TextRun({ text: name, bold: true, size: 34 })],
    }),
    ...(contactLine
      ? [
          new Paragraph({
            alignment: templateId === 'au_grad' ? AlignmentType.CENTER : AlignmentType.LEFT,
            spacing: { after: 140 },
            children: [new TextRun({ text: contactLine, color: '475569', size: 18 })],
          }),
        ]
      : []),
  ];

  let children: Array<Paragraph | Table>;
  if (templateId === 'compact_two_col') {
    const left = [...sectionSummary(resume, l), ...sectionSkillsAndExtras(resume, l)];
    const right = [...sectionEducation(resume, l), ...sectionWork(resume, l), ...sectionProjects(resume, l), ...sectionCampus(resume, l)];
    const table = new Table({
      width: { size: 100, type: WidthType.PERCENTAGE },
      rows: [
        new TableRow({
          children: [
            new TableCell({ width: { size: 34, type: WidthType.PERCENTAGE }, children: left.length > 0 ? left : [new Paragraph('')] }),
            new TableCell({ width: { size: 66, type: WidthType.PERCENTAGE }, children: right.length > 0 ? right : [new Paragraph('')] }),
          ],
        }),
      ],
    });
    children = [...headerParagraphs, table];
  } else if (templateId === 'campus_cn') {
    children = [
      ...headerParagraphs,
      ...sectionEducation(resume, l),
      ...sectionWork(resume, l),
      ...sectionProjects(resume, l),
      ...sectionCampus(resume, l),
      ...sectionSkillsAndExtras(resume, l),
      ...sectionSummary(resume, l),
    ];
  } else if (templateId === 'au_grad') {
    children = [
      ...headerParagraphs,
      ...sectionSummary(resume, l),
      ...sectionEducation(resume, l),
      ...sectionWork(resume, l),
      ...sectionProjects(resume, l),
      ...sectionSkillsAndExtras(resume, l),
      ...sectionReferees(resume, l),
    ];
  } else {
    children = [
      ...headerParagraphs,
      ...sectionSummary(resume, l),
      ...sectionWork(resume, l),
      ...sectionEducation(resume, l),
      ...sectionProjects(resume, l),
      ...sectionCampus(resume, l),
      ...sectionSkillsAndExtras(resume, l),
    ];
  }

  const doc = new Document({
    sections: [{ children }],
  });
  return new Uint8Array(await Packer.toArrayBuffer(doc));
}
