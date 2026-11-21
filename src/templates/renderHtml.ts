// Offline printable HTML resume renderer with 4 ATS/campus/compact/AU-grad templates.
import { languageLine, type Resume } from '../schema';
import type { MessageKey } from '../i18n';
import { resumeFullName } from './presets';

export type ResumeTemplateId = 'ats_clean' | 'campus_cn' | 'compact_two_col' | 'au_grad';

export interface TemplateMeta {
  id: ResumeTemplateId;
  nameKey: MessageKey;
  descKey: MessageKey;
}

export const RESUME_TEMPLATES: readonly TemplateMeta[] = [
  { id: 'ats_clean', nameKey: 'options.templates.ats_clean.name', descKey: 'options.templates.ats_clean.desc' },
  { id: 'campus_cn', nameKey: 'options.templates.campus_cn.name', descKey: 'options.templates.campus_cn.desc' },
  { id: 'compact_two_col', nameKey: 'options.templates.compact_two_col.name', descKey: 'options.templates.compact_two_col.desc' },
  { id: 'au_grad', nameKey: 'options.templates.au_grad.name', descKey: 'options.templates.au_grad.desc' },
] as const;

export function escHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

export interface Labels {
  summary: string;
  workRights: string;
  education: string;
  work: string;
  projects: string;
  campus: string;
  skills: string;
  awards: string;
  languages: string;
  certificates: string;
  referees: string;
  present: string;
  gpa: string;
  rank: string;
}

export function labelsFor(resume: Resume): Labels {
  if (resume.locale === 'zh-CN') {
    return {
      summary: '个人简介',
      workRights: '求职意向 / 身份',
      education: '教育背景',
      work: '工作与实习经历',
      projects: '项目经历',
      campus: '校园经历',
      skills: '专业技能',
      awards: '荣誉奖项',
      languages: '语言能力',
      certificates: '资格证书',
      referees: '推荐人',
      present: '至今',
      gpa: 'GPA',
      rank: '排名',
    };
  }
  return {
    summary: 'Profile Summary',
    workRights: 'Career Objective & Work Rights',
    education: 'Education',
    work: 'Experience',
    projects: 'Projects',
    campus: 'Leadership & Activities',
    skills: 'Skills',
    awards: 'Awards & Honours',
    languages: 'Languages',
    certificates: 'Certifications',
    referees: 'Referees',
    present: 'Present',
    gpa: 'GPA',
    rank: 'Rank',
  };
}

export function formatPeriod(start: string, end: string | null, ongoing: boolean | undefined, present: string): string {
  const s = start.trim();
  const e = ongoing ? present : (end ?? '').trim();
  if (s && e) return `${s} – ${e}`;
  return s || e;
}

export function splitBullets(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.replace(/^\s*[-•·*]\s*/, '').trim())
    .filter(Boolean);
}

export function joinContact(resume: Resume): string[] {
  const c = resume.contact;
  const items: string[] = [];
  if (c.phone.trim()) {
    const code = c.phoneCountryCode.trim();
    items.push(code && !c.phone.includes(code) ? `${code} ${c.phone.trim()}` : c.phone.trim());
  }
  if (c.email.trim()) items.push(c.email.trim());
  const place = [c.address.city, c.address.province, c.address.country].map((s) => s.trim()).filter(Boolean).join(', ');
  if (place) items.push(place);
  if (c.linkedin.trim()) items.push(c.linkedin.trim());
  if (c.github.trim()) items.push(c.github.trim());
  if (c.portfolio.trim()) items.push(c.portfolio.trim());
  return items;
}

function renderList(bullets: string[]): string {
  if (bullets.length === 0) return '';
  if (bullets.length === 1) return `<p class="desc">${escHtml(bullets[0]!)}</p>`;
  return `<ul>${bullets.map((b) => `<li>${escHtml(b)}</li>`).join('')}</ul>`;
}

function renderEducation(resume: Resume, l: Labels): string {
  if (resume.education.length === 0) return '';
  const items = resume.education
    .map((ed) => {
      const period = formatPeriod(ed.startDate, ed.endDate, ed.current, l.present);
      const sub = [
        ed.major.trim(),
        ed.gpa.trim() ? `${l.gpa}: ${ed.gpa.trim()}${ed.gpaScale.trim() ? `/${ed.gpaScale.trim()}` : ''}` : '',
        ed.ranking.trim() ? `${l.rank}: ${ed.ranking.trim()}` : '',
      ]
        .filter(Boolean)
        .join(' · ');
      const courses = ed.courses.trim() ? `<p class="muted">${escHtml(ed.courses.trim())}</p>` : '';
      return `<article class="entry">
        <div class="entry-head"><strong>${escHtml(ed.school || '—')}</strong><span class="meta">${escHtml(period)}</span></div>
        ${sub ? `<div class="entry-sub">${escHtml(sub)}</div>` : ''}
        ${courses}
      </article>`;
    })
    .join('');
  return `<section><h2>${escHtml(l.education)}</h2>${items}</section>`;
}

function renderWork(resume: Resume, l: Labels): string {
  if (resume.work.length === 0) return '';
  const items = resume.work
    .map((w) => {
      const period = formatPeriod(w.startDate, w.endDate, w.current, l.present);
      const head = [w.company.trim(), w.position.trim()].filter(Boolean).join(' · ');
      const bullets = renderList(splitBullets(w.description));
      return `<article class="entry">
        <div class="entry-head"><strong>${escHtml(head || '—')}</strong><span class="meta">${escHtml(period)}</span></div>
        ${bullets}
      </article>`;
    })
    .join('');
  return `<section><h2>${escHtml(l.work)}</h2>${items}</section>`;
}

function renderProjects(resume: Resume, l: Labels): string {
  if (resume.projects.length === 0) return '';
  const items = resume.projects
    .map((p) => {
      const period = formatPeriod(p.startDate, p.endDate, p.current, l.present);
      const head = [p.name.trim(), p.role.trim()].filter(Boolean).join(' · ');
      const link = p.link.trim() ? `<p class="muted">${escHtml(p.link.trim())}</p>` : '';
      return `<article class="entry">
        <div class="entry-head"><strong>${escHtml(head || '—')}</strong><span class="meta">${escHtml(period)}</span></div>
        ${link}
        ${renderList(splitBullets(p.description))}
      </article>`;
    })
    .join('');
  return `<section><h2>${escHtml(l.projects)}</h2>${items}</section>`;
}

function renderCampus(resume: Resume, l: Labels): string {
  if (resume.campus.length === 0) return '';
  const items = resume.campus
    .map((c) => {
      const period = formatPeriod(c.startDate, c.endDate, c.current, l.present);
      const head = [c.organization.trim(), c.role.trim()].filter(Boolean).join(' · ');
      return `<article class="entry">
        <div class="entry-head"><strong>${escHtml(head || '—')}</strong><span class="meta">${escHtml(period)}</span></div>
        ${renderList(splitBullets(c.description))}
      </article>`;
    })
    .join('');
  return `<section><h2>${escHtml(l.campus)}</h2>${items}</section>`;
}

function renderSkills(resume: Resume, l: Labels): string {
  if (resume.skills.length === 0 && resume.languages.length === 0 && resume.certificates.length === 0) return '';
  const blocks: string[] = [];
  if (resume.skills.length > 0) {
    blocks.push(
      `<section><h2>${escHtml(l.skills)}</h2><p class="inline-list">${resume.skills
        .map((s) => escHtml(s.level ? `${s.name} (${s.level})` : s.name))
        .join(' · ')}</p></section>`,
    );
  }
  if (resume.languages.length > 0) {
    blocks.push(
      `<section><h2>${escHtml(l.languages)}</h2><p class="inline-list">${resume.languages
        .map((lang) => escHtml(languageLine(lang)))
        .join(' · ')}</p></section>`,
    );
  }
  if (resume.certificates.length > 0) {
    blocks.push(
      `<section><h2>${escHtml(l.certificates)}</h2><p class="inline-list">${resume.certificates
        .map((c) => escHtml([c.name, c.date].filter(Boolean).join(' ')))
        .join(' · ')}</p></section>`,
    );
  }
  return blocks.join('');
}

function renderAwards(resume: Resume, l: Labels): string {
  if (resume.awards.length === 0) return '';
  const items = resume.awards
    .map((a) => `<li>${escHtml([a.name, a.level, a.date].filter(Boolean).join(' · '))}</li>`)
    .join('');
  return `<section><h2>${escHtml(l.awards)}</h2><ul>${items}</ul></section>`;
}

function renderSummary(resume: Resume, l: Labels): string {
  const parts: string[] = [];
  if (resume.selfIntroduction.trim()) {
    parts.push(`<section><h2>${escHtml(l.summary)}</h2><p class="desc">${escHtml(resume.selfIntroduction.trim())}</p></section>`);
  }
  if (resume.jobIntention.positions.length > 0 || resume.workRights.status) {
    const bits: string[] = [];
    if (resume.jobIntention.positions.length > 0) bits.push(resume.jobIntention.positions.join(', '));
    if (resume.jobIntention.cities.length > 0) bits.push(resume.jobIntention.cities.join(', '));
    if (resume.workRights.status) bits.push(`Work rights: ${resume.workRights.status}`);
    parts.push(`<section><h2>${escHtml(l.workRights)}</h2><p class="desc">${escHtml(bits.join(' · '))}</p></section>`);
  }
  return parts.join('');
}

function renderReferees(resume: Resume, l: Labels): string {
  if (resume.referees.length === 0) return '';
  const items = resume.referees
    .map((r) => `<li>${escHtml([r.name, r.title, r.company, r.email, r.phone].filter(Boolean).join(' · '))}</li>`)
    .join('');
  return `<section><h2>${escHtml(l.referees)}</h2><ul>${items}</ul></section>`;
}

const TEMPLATE_CSS: Record<ResumeTemplateId, string> = {
  ats_clean: `
    body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #1f2328; margin: 0; padding: 24px 28px; line-height: 1.5; font-size: 13px; }
    header { border-bottom: 2px solid #1f2328; padding-bottom: 10px; margin-bottom: 14px; }
    h1 { font-size: 22px; margin: 0 0 4px; }
    .contact { color: #4a5568; font-size: 12px; display: flex; flex-wrap: wrap; gap: 6px 14px; }
    h2 { font-size: 13px; text-transform: uppercase; letter-spacing: .04em; border-bottom: 1px solid #cbd5e1; padding-bottom: 3px; margin: 14px 0 8px; }
    .entry { margin-bottom: 9px; }
    .entry-head { display: flex; justify-content: space-between; gap: 12px; }
    .entry-sub, .meta, .muted { color: #4a5568; font-size: 12px; }
    ul { margin: 4px 0 0 18px; padding: 0; }
    p { margin: 3px 0; }
  `,
  campus_cn: `
    body { font-family: "PingFang SC", "Microsoft YaHei", system-ui, sans-serif; color: #162032; margin: 0; padding: 22px 26px; line-height: 1.5; font-size: 13px; }
    header { background: #f4f7fb; border-left: 4px solid #1d4ed8; padding: 12px 16px; margin-bottom: 14px; }
    h1 { font-size: 21px; margin: 0 0 4px; color: #1e3a8a; }
    .contact { color: #334155; font-size: 12px; display: flex; flex-wrap: wrap; gap: 6px 12px; }
    h2 { font-size: 14px; color: #1e3a8a; border-bottom: 1px solid #bfdbfe; padding-bottom: 3px; margin: 14px 0 8px; }
    .entry { margin-bottom: 9px; }
    .entry-head { display: flex; justify-content: space-between; gap: 12px; }
    .entry-sub, .meta, .muted { color: #475569; font-size: 12px; }
    ul { margin: 4px 0 0 18px; padding: 0; }
    p { margin: 3px 0; }
  `,
  compact_two_col: `
    body { font-family: system-ui, -apple-system, "PingFang SC", "Microsoft YaHei", sans-serif; color: #111827; margin: 0; padding: 20px 24px; line-height: 1.45; font-size: 12.5px; }
    header { border-bottom: 1px solid #d1d5db; padding-bottom: 8px; margin-bottom: 12px; }
    h1 { font-size: 20px; margin: 0 0 4px; }
    .contact { color: #4b5563; font-size: 11.5px; display: flex; flex-wrap: wrap; gap: 4px 12px; }
    .grid { display: grid; grid-template-columns: 32% 66%; gap: 2%; align-items: start; }
    h2 { font-size: 12px; text-transform: uppercase; color: #374151; border-bottom: 1px solid #e5e7eb; padding-bottom: 2px; margin: 10px 0 6px; }
    .entry { margin-bottom: 8px; }
    .entry-head { display: flex; justify-content: space-between; gap: 8px; }
    .entry-sub, .meta, .muted { color: #6b7280; font-size: 11.5px; }
    ul { margin: 3px 0 0 16px; padding: 0; }
    p { margin: 3px 0; }
  `,
  au_grad: `
    body { font-family: Georgia, "Times New Roman", "PingFang SC", serif; color: #1f2937; margin: 0; padding: 24px 28px; line-height: 1.5; font-size: 13px; }
    header { text-align: center; border-bottom: 1.5px solid #374151; padding-bottom: 10px; margin-bottom: 14px; }
    h1 { font-size: 22px; margin: 0 0 5px; letter-spacing: .02em; }
    .contact { color: #4b5563; font-size: 12px; display: flex; justify-content: center; flex-wrap: wrap; gap: 4px 12px; }
    h2 { font-size: 13px; font-family: system-ui, sans-serif; letter-spacing: .06em; text-transform: uppercase; color: #111827; border-bottom: 1px solid #d1d5db; padding-bottom: 2px; margin: 14px 0 8px; }
    .entry { margin-bottom: 10px; }
    .entry-head { display: flex; justify-content: space-between; gap: 12px; }
    .entry-sub, .meta, .muted { color: #4b5563; font-size: 12px; }
    ul { margin: 4px 0 0 18px; padding: 0; }
    p { margin: 3px 0; }
  `,
};

/** Render a complete offline, print-ready HTML document for any supported resume template. */
export function renderResumeHtml(resume: Resume, templateId: ResumeTemplateId): string {
  const l = labelsFor(resume);
  const name = resumeFullName(resume) || resume.title.trim() || 'Resume';
  const contactHtml = joinContact(resume).map((c) => `<span>${escHtml(c)}</span>`).join('');
  const header = `<header><h1>${escHtml(name)}</h1>${contactHtml ? `<div class="contact">${contactHtml}</div>` : ''}</header>`;

  let bodyInner = '';
  if (templateId === 'compact_two_col') {
    const side = [renderSummary(resume, l), renderSkills(resume, l), renderAwards(resume, l)].filter(Boolean).join('');
    const main = [renderEducation(resume, l), renderWork(resume, l), renderProjects(resume, l), renderCampus(resume, l)].filter(Boolean).join('');
    bodyInner = `${header}<div class="grid"><aside>${side}</aside><main>${main}</main></div>`;
  } else if (templateId === 'campus_cn') {
    bodyInner = [
      header,
      renderEducation(resume, l),
      renderWork(resume, l),
      renderProjects(resume, l),
      renderCampus(resume, l),
      renderAwards(resume, l),
      renderSkills(resume, l),
      renderSummary(resume, l),
    ].join('');
  } else if (templateId === 'au_grad') {
    bodyInner = [
      header,
      renderSummary(resume, l),
      renderEducation(resume, l),
      renderWork(resume, l),
      renderProjects(resume, l),
      renderSkills(resume, l),
      renderAwards(resume, l),
      renderReferees(resume, l),
    ].join('');
  } else {
    bodyInner = [
      header,
      renderSummary(resume, l),
      renderWork(resume, l),
      renderEducation(resume, l),
      renderProjects(resume, l),
      renderCampus(resume, l),
      renderSkills(resume, l),
      renderAwards(resume, l),
    ].join('');
  }

  return `<!doctype html>
<html lang="${resume.locale === 'zh-CN' ? 'zh-CN' : 'en'}">
<head>
<meta charset="utf-8" />
<title>${escHtml(name)}</title>
<style>
@page { size: A4; margin: 14mm; }
${TEMPLATE_CSS[templateId]}
@media print { body { padding: 0; } }
</style>
</head>
<body>${bodyInner}</body>
</html>`;
}
