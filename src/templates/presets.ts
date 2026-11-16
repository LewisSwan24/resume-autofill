// Mapping presets and placeholder interpolation for free-text / campus / AU graduate autofill.
import type { Locale, Resume } from '../schema';
import type { MessageKey } from '../i18n';
import { guessCompany } from '../tracker/guessCompany';

export type MappingPresetId = 'default' | 'cn_campus' | 'au_grad';

export interface MappingPresetInfo {
  id: MappingPresetId;
  labelKey: MessageKey;
}

export const MAPPING_PRESETS: readonly MappingPresetInfo[] = [
  { id: 'default', labelKey: 'options.preset.default' },
  { id: 'cn_campus', labelKey: 'options.preset.cn_campus' },
  { id: 'au_grad', labelKey: 'options.preset.au_grad' },
] as const;

export interface InterpolationContext {
  company?: string;
  role?: string;
  pageTitle?: string;
  pageUrl?: string;
  resume?: Resume;
}

const PLACEHOLDER_RE = /\{\{\s*(company|role|name|school|major)\s*\}\}/gi;

export function resumeFullName(resume?: Resume): string {
  if (!resume) return '';
  const { familyName, givenName, preferredName, englishName } = resume.basics;
  const joined =
    resume.locale === 'zh-CN'
      ? `${familyName.trim()}${givenName.trim()}`
      : [givenName.trim(), familyName.trim()].filter(Boolean).join(' ');
  return joined || preferredName.trim() || englishName.trim() || '';
}

/** Derive best-effort template variables from the current page + resume without inventing personal facts. */
export function buildTemplateVars(ctx: InterpolationContext): Record<'company' | 'role' | 'name' | 'school' | 'major', string> {
  let host = '';
  if (ctx.pageUrl) {
    try {
      host = new URL(ctx.pageUrl).host;
    } catch {
      host = '';
    }
  }
  const guessedCompany = ctx.company?.trim() || (host || ctx.pageTitle ? guessCompany(ctx.pageTitle, host) : '');
  const resume = ctx.resume;
  return {
    company: guessedCompany || (resume?.locale === 'zh-CN' ? '贵司' : 'your team'),
    role: ctx.role?.trim() || resume?.jobIntention.positions[0]?.trim() || (resume?.locale === 'zh-CN' ? '该岗位' : 'this role'),
    name: resumeFullName(resume),
    school: resume?.education[0]?.school.trim() || '',
    major: resume?.education[0]?.major.trim() || '',
  };
}

/** Expand {{company}}, {{role}}, {{name}}, {{school}}, {{major}} placeholders inside templateable strings. */
export function interpolateTemplateText(text: string, ctx: InterpolationContext): string {
  if (!text.includes('{{')) return text;
  const vars = buildTemplateVars(ctx);
  return text.replace(PLACEHOLDER_RE, (_full, key: string) => {
    const normalized = key.toLowerCase() as keyof typeof vars;
    return vars[normalized] ?? '';
  });
}

export function isValidPresetId(id: string | undefined): id is MappingPresetId {
  return id === 'default' || id === 'cn_campus' || id === 'au_grad';
}

/** Apply preset-specific formatting rules without altering resume data when no preset transformation applies. */
export function formatWithPreset(
  fieldKey: string,
  value: string,
  _locale: Locale,
  presetId: MappingPresetId,
  ctx: InterpolationContext = {},
): string {
  const expanded = interpolateTemplateText(value, ctx);
  if (presetId === 'au_grad') {
    if (fieldKey === 'jobIntention.noticePeriod' && expanded.trim().toLowerCase() === 'immediately') {
      return 'Immediately available';
    }
  }
  return expanded;
}
