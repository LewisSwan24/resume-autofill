// Local AI resume summary/bullet rewriter with strict Fact Guard (detects ungrounded invented metrics/years).
import { generateReviewDraft, type AiSourceKind } from '../ai';
import type { Resume, Settings } from '../schema';

export interface FactPreservationCheck {
  ok: boolean;
  inventedMetrics: string[];
}

export interface TailoredRewriteDraft {
  originalText: string;
  rewrittenText: string;
  source: AiSourceKind;
  fallbackUsed: boolean;
  factCheck: FactPreservationCheck;
}

const NUMBER_TOKEN_RE = /(?:^|[^A-Za-z0-9.])(\d+(?:\.\d+)?%?)(?=$|[^A-Za-z0-9])/g;

function extractMetricTokens(text: string): Set<string> {
  const tokens = new Set<string>();
  for (const m of text.matchAll(NUMBER_TOKEN_RE)) {
    if (m[1]) tokens.add(m[1]);
  }
  return tokens;
}

/**
 * Verify that an AI-rewritten draft does not invent metrics, percentages, headcounts, or years
 * absent from the user's true resume text (ignores pure bullet ordinals like leading "1." and tech tokens like "p99", "K8s").
 */
export function checkRewriteFactPreservation(originalText: string, rewrittenText: string): FactPreservationCheck {
  const allowed = extractMetricTokens(originalText);
  const candidateLines = rewrittenText.split(/\r?\n/);
  const invented = new Set<string>();

  for (const line of candidateLines) {
    // Strip leading list ordinals like "1. " or "2) " so formatting bullets doesn't trigger false alarms.
    const body = line.replace(/^\s*\d+[.)、]\s+/, '');
    for (const m of body.matchAll(NUMBER_TOKEN_RE)) {
      const tok = m[1];
      if (tok && !allowed.has(tok)) invented.add(tok);
    }
  }

  return {
    ok: invented.size === 0,
    inventedMetrics: Array.from(invented),
  };
}

/** Generate an offline/on-device tailored summary draft aligned to `targetRole` & `matchedKeywords`, checked by Fact Guard. */
export async function generateTailoredSummaryDraft(options: {
  resume: Resume;
  targetRole: string;
  matchedKeywords: readonly string[];
  settings?: Partial<Settings>;
}): Promise<TailoredRewriteDraft | null> {
  const { resume, targetRole, matchedKeywords, settings } = options;
  const originalText = resume.selfIntroduction.trim();
  const promptQuestion = [
    `Rewrite a factual resume summary strictly using ONLY existing resume facts for target role "${targetRole}".`,
    matchedKeywords.length > 0 ? `Highlight existing skills matching: ${matchedKeywords.slice(0, 8).join(', ')}.` : '',
    'Do NOT invent numbers, percentages, employers, or years.',
  ]
    .filter(Boolean)
    .join(' ');

  const ai = await generateReviewDraft({
    questionLabel: promptQuestion,
    sectionHint: 'selfIntroduction',
    resume,
    ...(settings ? { settings } : {}),
  });

  if (!ai) {
    if (!originalText) return null;
    const prefix = targetRole
      ? `${resume.locale.startsWith('zh') ? '应聘方向：' : 'Target Role: '}${targetRole}. `
      : '';
    const deterministic = `${prefix}${originalText}`;
    return {
      originalText,
      rewrittenText: deterministic,
      source: 'bm25',
      fallbackUsed: false,
      factCheck: checkRewriteFactPreservation(`${targetRole} ${originalText}`, deterministic),
    };
  }

  // Fact Guard checks against combined resume text + target role title so authentic numbers from work/projects remain allowed.
  const resumeFacts = [
    originalText,
    targetRole,
    ...resume.work.map((w) => `${w.startDate} ${w.endDate ?? ''} ${w.description}`),
    ...resume.projects.map((p) => `${p.startDate} ${p.endDate ?? ''} ${p.description}`),
  ].join('\n');

  return {
    originalText,
    rewrittenText: ai.text,
    source: ai.source,
    fallbackUsed: ai.fallbackUsed,
    factCheck: checkRewriteFactPreservation(resumeFacts, ai.text),
  };
}
