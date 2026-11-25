// A draft long-text answer from the applicant's own resume, the page's company and job, and a template. Only what the
// resume and the page say goes in; the applicant reads it in the side panel before anything reaches the form.
import type { Resume } from '../schema';
import type { JobContext } from './jobContext';
import type { LongTextKind } from './kinds';
import { fitLength, type LengthLimit } from './limit';
import { DEFAULT_TEMPLATES, PLACEHOLDER_NAMES, type TemplateKind, type TemplateLang, type Templates } from './templates';

export interface LongTextDraft {
  text: string;
  /** True when the draft was shortened to fit the box. */
  cut: boolean;
  /** Where the words came from: a resume path, or the template of a kind. */
  source: string;
}

export interface DraftOptions {
  job?: JobContext;
  /** The card's entry, for project duties. */
  entryIndex?: number;
  limit?: LengthLimit | null;
  /** The applicant's own templates in the resume's language; a kind left out uses the default. */
  templates?: Templates;
}

export const langOf = (resume: Resume): TemplateLang => (/^zh/i.test(resume.locale ?? '') ? 'zh' : 'en');

const ZH_END = /[。！？…]$/;
const EN_END = /[.!?…]$/;

const firstSentence = (text: string): string => {
  const t = text.trim().replace(/\s+/g, ' ');
  const m = /^.+?(?:[。！？]|[.!?](?=\s|$))/.exec(t);
  return (m ? m[0] : t).trim();
};

const asSentence = (text: string, lang: TemplateLang): string => {
  const t = text.trim();
  if (!t) return '';
  if (lang === 'zh') return ZH_END.test(t) ? t : `${t.replace(/[，,；;：:]$/, '')}。`;
  return EN_END.test(t) ? t : `${t.replace(/[,;:]$/, '')}.`;
};

/** Lower-cases the first letter of an English clause unless it starts an acronym or a name like "TypeScript". */
const lowerFirst = (text: string): string => (/^[A-Z][a-z]/.test(text) ? text[0]!.toLowerCase() + text.slice(1) : text);

const list = (items: string[], lang: TemplateLang): string => {
  const names = items.map((i) => i.trim()).filter(Boolean).slice(0, 5);
  if (lang === 'zh' || names.length < 2) return names.join('、');
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
};

function highlightOf(resume: Resume, lang: TemplateLang): string {
  const work = resume.work.find((w) => w.description.trim() && w.company.trim());
  if (work) {
    const first = firstSentence(work.description);
    const at = work.position.trim();
    if (lang === 'zh') return asSentence(at ? `在${work.company}担任${at}期间，${first}` : `在${work.company}期间，${first}`, lang);
    return asSentence(at ? `As ${at} at ${work.company}, ${lowerFirst(first)}` : `At ${work.company}, ${lowerFirst(first)}`, lang);
  }
  const project = resume.projects.find((p) => p.description.trim() && p.name.trim());
  if (project) {
    const first = firstSentence(project.description);
    const role = project.role.trim();
    if (lang === 'zh') return asSentence(role ? `在${project.name}项目中担任${role}，${first}` : `在${project.name}项目中，${first}`, lang);
    return asSentence(role ? `As ${role} on ${project.name}, ${lowerFirst(first)}` : `On ${project.name}, ${lowerFirst(first)}`, lang);
  }
  return '';
}

function nameOf(resume: Resume, lang: TemplateLang): string {
  const { familyName, givenName, englishName } = resume.basics;
  if (lang === 'zh') return `${familyName}${givenName}`.trim();
  return (englishName.trim() || [givenName, familyName].filter((n) => n.trim()).join(' ')).trim();
}

/** Everything a placeholder can stand for; an empty string means the page or the resume does not say. */
function valuesOf(resume: Resume, lang: TemplateLang, job: JobContext): Record<string, string> {
  return {
    company: job.company?.trim() ?? '',
    position: job.position?.trim() ?? '',
    name: nameOf(resume, lang),
    intro: asSentence(resume.selfIntroduction, lang),
    highlight: highlightOf(resume, lang),
    skills: list(resume.skills.map((s) => s.name), lang),
    awards: list(resume.awards.map((a) => a.name), lang),
    intention: (resume.jobIntention.positions.find((p) => p.trim()) ?? resume.jobIntention.industry).trim(),
  };
}

const PLACEHOLDER = /\{([^{}]+)\}/g;
const TEMPLATE_SENTENCE = /[^。！？!?.\n]+(?:[。！？!?.]+|$)\s*/g;

/** Fills a template, leaving out each sentence with a placeholder that has nothing behind it. */
function fill(template: string, values: Record<string, string>, lang: TemplateLang): { text: string; resolved: number } {
  let resolved = 0;
  const lineJoin = lang === 'zh' ? '' : ' ';
  const paragraphs = template.split(/\n\s*\n/).map((paragraph) =>
    paragraph
      .split('\n')
      .map((line) =>
        (line.match(TEMPLATE_SENTENCE) ?? [])
          .filter((sentence) => {
            const names = [...sentence.matchAll(PLACEHOLDER)].map((m) => PLACEHOLDER_NAMES[m[1]!.trim()]);
            const ok = names.every((n) => n !== undefined && values[n] !== '');
            if (ok && names.length > 0) resolved += 1;
            return ok;
          })
          .map((sentence) => sentence.replace(PLACEHOLDER, (_, name: string) => values[PLACEHOLDER_NAMES[name.trim()]!]!))
          .join('')
          .trim(),
      )
      .filter(Boolean)
      .join(lineJoin),
  );
  return { text: paragraphs.filter(Boolean).join('\n\n'), resolved };
}

function projectDuties(resume: Resume, index: number, lang: TemplateLang): { text: string; source: string } | null {
  const project = resume.projects[index];
  if (!project || !project.description.trim()) return null;
  const role = project.role.trim();
  const description = project.description.trim();
  const text = role
    ? lang === 'zh'
      ? `担任${role}，${description}`
      : `As ${role}, ${lowerFirst(description)}`
    : description;
  return { text: asSentence(text, lang), source: `projects[${index}].description` };
}

export function draftLongText(kind: LongTextKind, resume: Resume, opts: DraftOptions = {}): LongTextDraft | null {
  const lang = langOf(resume);
  let made: { text: string; source: string } | null;
  if (kind === 'selfEvaluation') {
    made = resume.selfIntroduction.trim() ? { text: resume.selfIntroduction.trim(), source: 'selfIntroduction' } : null;
  } else if (kind === 'projectDuties') {
    made = projectDuties(resume, opts.entryIndex ?? 0, lang);
  } else {
    const template = opts.templates?.[kind as TemplateKind]?.trim() || DEFAULT_TEMPLATES[lang][kind];
    const { text, resolved } = fill(template, valuesOf(resume, lang, opts.job ?? {}), lang);
    // Only boilerplate left, with nothing from the page or the resume in it: no draft at all.
    made = text && resolved > 0 ? { text, source: `template.${kind}` } : null;
  }
  if (!made) return null;
  const fitted = opts.limit ? fitLength(made.text, opts.limit) : { text: made.text, cut: false };
  return fitted.text ? { text: fitted.text, cut: fitted.cut, source: made.source } : null;
}
