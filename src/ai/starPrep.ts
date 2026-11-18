// Factual STAR (Situation / Task / Action / Result) interview outline generator with Fact Guard.
import type { Resume, Settings } from '../schema';
import { checkRewriteFactPreservation, type FactPreservationCheck } from '../tailor/rewriter';
import { retrieveHybridMatches } from './hybridRetriever';
import { generateReviewDraft, type AiSourceKind } from './suggest';

export interface StarOutline {
  situation: string;
  task: string;
  action: string;
  result: string;
}

export interface StarPrepResult {
  entryKind: 'work' | 'projects';
  entryIndex: number;
  entryTitle: string;
  targetRole: string;
  outline: StarOutline;
  formattedText: string;
  source: AiSourceKind;
  fallbackUsed: boolean;
  factCheck: FactPreservationCheck;
}

const METRIC_CLAUSE_RE = /\d+(?:\.\d+)?\s*(?:%|倍|x|ms|s|万|亿|k|qps|rps|dau|mau)/i;

function splitClauses(desc: string): string[] {
  return desc
    .split(/[\r\n;；。]+/)
    .map((s) => s.replace(/^[-*•\d.)、\s]+/, '').trim())
    .filter(Boolean);
}

export function formatStarOutline(outline: StarOutline, isZh: boolean): string {
  const labels = isZh
    ? { s: 'S (情境)', t: 'T (任务)', a: 'A (行动)', r: 'R (结果)' }
    : { s: 'Situation', t: 'Task', a: 'Action', r: 'Result' };
  return [
    `${labels.s}: ${outline.situation}`,
    `${labels.t}: ${outline.task}`,
    `${labels.a}: ${outline.action}`,
    `${labels.r}: ${outline.result}`,
  ].join('\n');
}

function parseStarResponse(text: string): StarOutline | null {
  const pick = (re: RegExp) => re.exec(text)?.[1]?.trim() ?? '';
  const situation = pick(/(?:^|\n)\s*(?:S(?:\s*\([^)]*\))?|Situation|情境)\s*[:：]\s*(.+)/i);
  const task = pick(/(?:^|\n)\s*(?:T(?:\s*\([^)]*\))?|Task|任务)\s*[:：]\s*(.+)/i);
  const action = pick(/(?:^|\n)\s*(?:A(?:\s*\([^)]*\))?|Action|行动)\s*[:：]\s*(.+)/i);
  const result = pick(/(?:^|\n)\s*(?:R(?:\s*\([^)]*\))?|Result|结果)\s*[:：]\s*(.+)/i);
  if (!situation || !action) return null;
  return {
    situation,
    task: task || situation,
    action,
    result: result || action,
  };
}

/** Build a strictly grounded STAR outline directly from existing resume fields without inventing metrics. */
export function buildDeterministicStarOutline(
  resume: Resume,
  entryKind: 'work' | 'projects',
  entryIndex: number,
  targetRole: string,
): { entryTitle: string; originalFacts: string; outline: StarOutline } | null {
  const isZh = resume.locale.startsWith('zh');
  if (entryKind === 'work') {
    const entry = resume.work[entryIndex];
    if (!entry) return null;
    const period = `${entry.startDate || '?'}–${entry.current ? (isZh ? '至今' : 'Present') : (entry.endDate ?? '')}`;
    const title = [entry.company, entry.position].filter(Boolean).join(' · ') || `Work #${entryIndex + 1}`;
    const clauses = splitClauses(entry.description);
    const metricClause = clauses.find((c) => METRIC_CLAUSE_RE.test(c));
    const actionClauses = clauses.filter((c) => c !== metricClause).slice(0, 2);

    const situation = isZh
      ? `在 ${entry.company || '所在团队'} 担任 ${entry.position || '核心成员'} (${period})${targetRole ? `，围绕 ${targetRole} 相关业务场景开展工作` : ''}。`
      : `Served as ${entry.position || 'contributor'} at ${entry.company || 'the team'} (${period})${targetRole ? `, aligned with ${targetRole}` : ''}.`;
    const task = clauses[0] ?? (isZh ? `承担 ${entry.position || '核心模块'} 交付与稳定性保障任务。` : `Owned delivery and reliability for ${entry.position || 'core scope'}.`);
    const action = (actionClauses.length > 0 ? actionClauses.join(isZh ? '；' : '; ') : clauses.join(isZh ? '；' : '; ')) || task;
    const result =
      metricClause ??
      clauses.at(-1) ??
      (isZh ? '按期完成既定研发交付目标（建议补充具体量化指标）。' : 'Delivered assigned scope on schedule (add concrete metrics if available).');

    return {
      entryTitle: title,
      originalFacts: `${title} ${period} ${entry.description}`,
      outline: { situation, task, action, result },
    };
  }

  const entry = resume.projects[entryIndex];
  if (!entry) return null;
  const period = `${entry.startDate || '?'}–${entry.current ? (isZh ? '至今' : 'Present') : (entry.endDate ?? '')}`;
  const title = [entry.name, entry.role].filter(Boolean).join(' · ') || `Project #${entryIndex + 1}`;
  const clauses = splitClauses(entry.description);
  const metricClause = clauses.find((c) => METRIC_CLAUSE_RE.test(c));
  const actionClauses = clauses.filter((c) => c !== metricClause).slice(0, 2);

  const situation = isZh
    ? `在「${entry.name || '核心项目'}」中担任 ${entry.role || '主要负责人'} (${period})${targetRole ? `，契合 ${targetRole} 方向` : ''}。`
    : `Contributed as ${entry.role || 'owner'} on "${entry.name || 'project'}" (${period})${targetRole ? `, aligned with ${targetRole}` : ''}.`;
  const task = clauses[0] ?? (isZh ? `负责项目关键架构设计与核心功能落地。` : `Owned key architecture and core implementation tasks.`);
  const action = (actionClauses.length > 0 ? actionClauses.join(isZh ? '；' : '; ') : clauses.join(isZh ? '；' : '; ')) || task;
  const result =
    metricClause ??
    clauses.at(-1) ??
    (isZh ? '完成项目上线与阶段性验收（建议补充性能/业务指标）。' : 'Shipped project milestones reliably (add impact metrics if available).');

  return {
    entryTitle: title,
    originalFacts: `${title} ${period} ${entry.description}`,
    outline: { situation, task, action, result },
  };
}

/** Generate a grounded STAR interview prep outline with hybrid entry ranking and Fact Guard validation. */
export async function generateStarInterviewPrep(options: {
  resume: Resume;
  targetRole?: string;
  entryKind?: 'work' | 'projects' | 'auto';
  entryIndex?: number;
  settings?: Partial<Settings>;
}): Promise<StarPrepResult | null> {
  const { resume, settings } = options;
  const targetRole = (options.targetRole ?? resume.jobIntention.positions[0] ?? '').trim();
  const isZh = resume.locale.startsWith('zh');

  let kind: 'work' | 'projects' = options.entryKind === 'projects' ? 'projects' : 'work';
  let index = options.entryIndex ?? 0;

  if (!options.entryKind || options.entryKind === 'auto') {
    if (targetRole) {
      const hits = await retrieveHybridMatches(targetRole, resume, { limit: 6 });
      const expHit = hits.find((h) => h.id.startsWith('work:') || h.id.startsWith('proj:'));
      if (expHit) {
        const [prefix, idxStr] = expHit.id.split(':');
        kind = prefix === 'proj' ? 'projects' : 'work';
        index = Number(idxStr) || 0;
      }
    }
    if (kind === 'work' && resume.work.length === 0 && resume.projects.length > 0) {
      kind = 'projects';
      index = 0;
    } else if (kind === 'projects' && resume.projects.length === 0 && resume.work.length > 0) {
      kind = 'work';
      index = 0;
    }
  }

  const base = buildDeterministicStarOutline(resume, kind, index, targetRole);
  if (!base) return null;

  const allowAi = settings?.aiLayerMode !== 'bm25_only';
  if (allowAi) {
    const promptQuestion = [
      `Create a concise 4-line STAR interview answer strictly using ONLY facts from "${base.entryTitle}".`,
      'Format lines strictly as: Situation: ... / Task: ... / Action: ... / Result: ...',
      'Never invent numbers, percentages, employers, or dates.',
    ].join(' ');

    const draft = await generateReviewDraft({
      questionLabel: promptQuestion,
      sectionHint: kind,
      resume,
      ...(settings ? { settings } : {}),
    });

    if (draft && draft.source !== 'bm25') {
      const parsed = parseStarResponse(draft.text);
      if (parsed) {
        const formatted = formatStarOutline(parsed, isZh);
        const factCheck = checkRewriteFactPreservation(`${targetRole} ${base.originalFacts}`, formatted);
        if (factCheck.ok) {
          return {
            entryKind: kind,
            entryIndex: index,
            entryTitle: base.entryTitle,
            targetRole,
            outline: parsed,
            formattedText: formatted,
            source: draft.source,
            fallbackUsed: draft.fallbackUsed,
            factCheck,
          };
        }
        // Fact Guard rejected invented numbers: fall back cleanly while preserving diagnostic flag.
        return {
          entryKind: kind,
          entryIndex: index,
          entryTitle: base.entryTitle,
          targetRole,
          outline: base.outline,
          formattedText: formatStarOutline(base.outline, isZh),
          source: 'bm25',
          fallbackUsed: true,
          factCheck,
        };
      }
    }
  }

  const formattedText = formatStarOutline(base.outline, isZh);
  return {
    entryKind: kind,
    entryIndex: index,
    entryTitle: base.entryTitle,
    targetRole,
    outline: base.outline,
    formattedText,
    source: 'bm25',
    fallbackUsed: false,
    factCheck: checkRewriteFactPreservation(base.originalFacts, formattedText),
  };
}
